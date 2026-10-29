import { chromium, type Browser, type BrowserContext, type Page, type Request } from "playwright-core";
import {
  ChromeActionError,
  type ChromeActionInput,
  safeDisplayUrl,
  validateBrowserUrl,
  validateCdpEndpoint,
  validateChromeActionInput,
  isLoopbackHost,
  assertPublicBrowserTarget
} from "./security.js";

type ConsoleEntry = { time: string; type: string; text: string; url?: string };
type NetworkEntry = { time: string; method: string; url: string; resourceType: string; status: number | null; failed: boolean };
type PageDetails = { index: number; title: string; url: string; closed: boolean };

export class ChromeController {
  private browser?: Browser;
  private context?: BrowserContext;
  private currentPage?: Page;
  private contextRouted = false;
  private readonly attachedPages = new WeakSet<Page>();
  private readonly consoleEntries: ConsoleEntry[] = [];
  private readonly networkEntries: NetworkEntry[] = [];
  private readonly requestEntries = new WeakMap<Request, NetworkEntry>();

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  private pushBounded<T>(target: T[], item: T, limit = 200): void {
    target.push(item);
    if (target.length > limit) target.splice(0, target.length - limit);
  }

  private async ensureBrowser(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
    const endpoint = validateCdpEndpoint(this.env.CHROME_CDP_URL);
    if (!this.browser?.isConnected()) {
      try {
        this.browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 });
      } catch {
        throw new ChromeActionError(
          "CHROME_NOT_REACHABLE",
          "Could not connect to Chrome DevTools. Start Chromium with remote debugging on 127.0.0.1:9222 and use a dedicated browser profile.",
          503
        );
      }
      this.context = undefined;
      this.currentPage = undefined;
      this.contextRouted = false;
    }

    const browser = this.browser;
    const context = browser.contexts()[0];
    if (!context) {
      throw new ChromeActionError("CHROME_CONTEXT_MISSING", "Chrome is reachable but has no debuggable browser context.", 503);
    }
    this.context = context;

    if (!this.contextRouted) {
      await context.route("**/*", async (route) => {
        const raw = route.request().url();
        if (/^(?:about:|data:|blob:)/i.test(raw)) {
          await route.continue();
          return;
        }
        try {
          const target = validateBrowserUrl(raw, this.env);
          await assertPublicBrowserTarget(target, this.env);
          await route.continue();
        } catch {
          await route.abort("blockedbyclient");
        }
      });
      this.contextRouted = true;
    }

    let pages = context.pages();
    if (!pages.length) pages = [await context.newPage()];
    let page = this.currentPage && !this.currentPage.isClosed() && pages.includes(this.currentPage)
      ? this.currentPage
      : pages[pages.length - 1];
    this.currentPage = page;
    this.attachPage(page);
    return { browser, context, page };
  }

  private attachPage(page: Page): void {
    if (this.attachedPages.has(page)) return;
    this.attachedPages.add(page);

    page.on("console", (message) => {
      const locationUrl = message.location()?.url;
      const entry: ConsoleEntry = {
        time: new Date().toISOString(),
        type: message.type().slice(0, 40),
        text: message.text().slice(0, 1500)
      };
      if (locationUrl) entry.url = safeDisplayUrl(locationUrl);
      this.pushBounded(this.consoleEntries, entry);
    });
    page.on("pageerror", (error) => {
      this.pushBounded(this.consoleEntries, {
        time: new Date().toISOString(),
        type: "pageerror",
        text: error.message.slice(0, 1500),
        url: safeDisplayUrl(page.url())
      });
    });
    page.on("request", (request) => {
      const entry: NetworkEntry = {
        time: new Date().toISOString(),
        method: request.method().slice(0, 20),
        url: safeDisplayUrl(request.url()),
        resourceType: request.resourceType().slice(0, 40),
        status: null,
        failed: false
      };
      this.requestEntries.set(request, entry);
      this.pushBounded(this.networkEntries, entry);
    });
    page.on("response", (response) => {
      const entry = this.requestEntries.get(response.request());
      if (entry) entry.status = response.status();
    });
    page.on("requestfailed", (request) => {
      const entry = this.requestEntries.get(request);
      if (entry) entry.failed = true;
    });
    page.on("close", () => {
      if (this.currentPage === page) this.currentPage = undefined;
    });
  }

  private async pageDetails(page: Page, index: number): Promise<PageDetails> {
    let title = "";
    try { title = await page.title(); } catch { /* closing tab */ }
    return { index, title: title.slice(0, 300), url: safeDisplayUrl(page.url()), closed: page.isClosed() };
  }

  private async getMetrics(session: Awaited<ReturnType<BrowserContext["newCDPSession"]>>): Promise<Record<string, number>> {
    const result = await session.send("Performance.getMetrics") as { metrics?: Array<{ name: string; value: number }> };
    const output: Record<string, number> = {};
    for (const metric of result.metrics || []) output[metric.name] = metric.value;
    return output;
  }

  private async runPerformanceTrace(page: Page, durationMs: number): Promise<Record<string, unknown>> {
    const session = await page.context().newCDPSession(page);
    const events: Array<Record<string, any>> = [];
    let droppedEvents = 0;
    let finishTrace: (() => void) | undefined;
    const traceComplete = new Promise<void>((resolve) => { finishTrace = resolve; });
    session.on("Tracing.dataCollected", (payload: { value?: Array<Record<string, any>> }) => {
      const values = payload?.value || [];
      const remaining = Math.max(0, 30000 - events.length);
      events.push(...values.slice(0, remaining));
      droppedEvents += Math.max(0, values.length - remaining);
    });
    session.once("Tracing.tracingComplete", () => finishTrace?.());

    await session.send("Performance.enable");
    const before = await this.getMetrics(session);
    await session.send("Tracing.start", {
      categories: "devtools.timeline,loading,v8.cpu_profiler,blink.user_timing",
      transferMode: "ReportEvents"
    });
    await page.waitForTimeout(durationMs);
    await session.send("Tracing.end");

    let timer: ReturnType<typeof setTimeout> | undefined;
    const completed = await Promise.race([
      traceComplete.then(() => true),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 8000); })
    ]);
    if (timer) clearTimeout(timer);
    if (!completed) {
      try { await session.detach(); } catch { /* CDP may already be closed */ }
      throw new ChromeActionError("TRACE_TIMEOUT", "Chrome did not finish returning its performance trace before the deadline.", 504);
    }

    const after = await this.getMetrics(session);
    try { await session.detach(); } catch { /* ignore closed CDP sessions */ }

    const longEvents = events
      .filter((event) => event.ph === "X" && Number.isFinite(event.dur) && event.dur >= 20000)
      .map((event) => ({
        name: String(event.name || "unknown").slice(0, 120),
        category: String(event.cat || "").slice(0, 160),
        durationMs: Math.round((Number(event.dur) / 1000) * 10) / 10
      }))
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 15);

    const metricNames = [
      "TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration",
      "JSHeapUsedSize", "LayoutCount", "RecalcStyleCount", "Nodes"
    ];
    const metricDelta: Record<string, number> = {};
    for (const name of metricNames) {
      if (Number.isFinite(before[name]) && Number.isFinite(after[name])) {
        const delta = after[name] - before[name];
        metricDelta[name] = name === "JSHeapUsedSize"
          ? Math.round(delta / 1024)
          : (name.endsWith("Duration") ? Math.round(delta * 1000 * 10) / 10 : Math.round(delta));
      }
    }

    const insights: string[] = [];
    if (longEvents.some((event) => event.durationMs >= 100)) {
      insights.push("At least one main-thread trace event exceeded 100 ms; inspect the longest events for long JavaScript or rendering work.");
    } else if (longEvents.some((event) => event.durationMs >= 50)) {
      insights.push("Some trace events exceeded 50 ms; review long tasks and split expensive work to protect responsiveness.");
    } else {
      insights.push("No trace event of 50 ms or longer was captured in this bounded sample; this does not rule out intermittent jank.");
    }
    if ((metricDelta.LayoutDuration || 0) > 50) insights.push("Layout consumed more than 50 ms during the sample; reduce layout thrashing and batch DOM writes.");
    if ((metricDelta.RecalcStyleDuration || 0) > 50) insights.push("Style recalculation consumed more than 50 ms; simplify selectors and avoid repeated style-invalidating writes.");
    if ((metricDelta.JSHeapUsedSize || 0) > 10240) insights.push("JS heap grew by more than 10 MB during the sample; inspect retained objects and repeated allocations.");

    return {
      durationMs,
      url: safeDisplayUrl(page.url()),
      metricsDelta: metricDelta,
      longestTraceEvents: longEvents,
      eventCount: events.length,
      droppedEvents,
      insights
    };
  }

  async execute(inputValue: unknown): Promise<Record<string, unknown>> {
    const input: ChromeActionInput = validateChromeActionInput(inputValue);
    const { browser, context, page } = await this.ensureBrowser();

    if (input.action === "status") {
      const pages = await Promise.all(context.pages().map((candidate, index) => this.pageDetails(candidate, index)));
      return { state: "ready", connected: browser.isConnected(), pageCount: pages.length, pages };
    }
    if (input.action === "navigate") {
      const target = validateBrowserUrl(input.url, this.env);
      await assertPublicBrowserTarget(target, this.env);
      await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 20000 });
      const finalUrl = validateBrowserUrl(page.url(), this.env);
      return { state: "completed", action: input.action, title: (await page.title()).slice(0, 300), url: safeDisplayUrl(finalUrl.toString()) };
    }
    if (input.action === "page_snapshot") {
      const snapshot = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
      return { state: "completed", action: input.action, title: (await page.title()).slice(0, 300), url: safeDisplayUrl(page.url()), text: snapshot.slice(0, 12000) };
    }
    if (input.action === "console_logs") {
      return { state: "completed", action: input.action, entries: this.consoleEntries.slice(-Math.min(input.limit || 30, 100)) };
    }
    if (input.action === "network_requests") {
      return { state: "completed", action: input.action, entries: this.networkEntries.slice(-Math.min(input.limit || 30, 100)) };
    }
    if (input.action === "screenshot") {
      const buffer = await page.screenshot({ type: "jpeg", quality: 65, fullPage: false, animations: "disabled", timeout: 10000 });
      if (buffer.byteLength > 1200000) {
        throw new ChromeActionError("SCREENSHOT_TOO_LARGE", "Screenshot exceeded the 1.2 MB bridge limit. Resize the browser viewport and retry.", 413);
      }
      return {
        state: "completed",
        action: input.action,
        url: safeDisplayUrl(page.url()),
        mimeType: "image/jpeg",
        bytes: buffer.byteLength,
        imageBase64: buffer.toString("base64")
      };
    }
    if (input.action === "click" || input.action === "fill") {
      const locator = page.locator(input.selector as string);
      const count = await locator.count();
      if (count !== 1) {
        throw new ChromeActionError("SELECTOR_NOT_UNIQUE", "The selector must match exactly one element; it matched " + count + ".");
      }
      const details = await locator.evaluate((element) => {
        const node = element as HTMLElement;
        const inputNode = element as HTMLInputElement;
        const text = String(node.innerText || node.getAttribute("aria-label") || node.getAttribute("title") || "").slice(0, 300);
        return {
          tag: node.tagName.toLowerCase(),
          type: String(inputNode.type || "").toLowerCase(),
          text,
          autocomplete: String(node.getAttribute("autocomplete") || "").toLowerCase(),
          name: String(node.getAttribute("name") || "").toLowerCase(),
          formAction: inputNode.form?.action || "",
          hasForm: Boolean(inputNode.form)
        };
      });
      if (input.action === "fill") {
        if (details.type === "password" || /(?:cc-|one-time-code|current-password|new-password)/i.test(details.autocomplete) ||
          /(?:password|passwd|token|secret|credit.?card|cvv|otp)/i.test(details.name)) {
          throw new ChromeActionError("SENSITIVE_FIELD_BLOCKED", "Filling password, token, one-time-code, or payment fields is disabled in the browser bridge.", 403);
        }
        await locator.fill(input.text as string, { timeout: 5000 });
        return { state: "completed", action: input.action, selector: input.selector, valueReturned: false };
      }

      const current = new URL(page.url());
      const localPage = isLoopbackHost(current.hostname);
      const highImpact = /(?:submit|send|publish|post|pay|purchase|buy|checkout|delete|remove|book|reserve|confirm|cancel|sign out|log out|accept terms|place order)/i.test(details.text) ||
        details.type === "submit" || details.tag === "form";
      const crossOriginForm = Boolean(details.formAction) && (() => {
        try { return new URL(details.formAction).origin !== current.origin; } catch { return true; }
      })();
      if ((highImpact || crossOriginForm) && !localPage) {
        if (!(input.confirmExternalAction === true && this.env.CHROME_ALLOW_EXTERNAL_ACTIONS === "true")) {
          throw new ChromeActionError(
            "EXTERNAL_ACTION_CONFIRMATION_REQUIRED",
            "This click looks like a submission or consequential action on an external site. It is blocked unless the explicit browser confirmation flag and CHROME_ALLOW_EXTERNAL_ACTIONS=true are both set.",
            403
          );
        }
      }
      await locator.click({ timeout: 5000 });
      return { state: "completed", action: input.action, selector: input.selector, title: (await page.title()).slice(0, 300), url: safeDisplayUrl(page.url()) };
    }
    if (input.action === "performance_trace") {
      const trace = await this.runPerformanceTrace(page, input.durationMs || 3000);
      return { state: "completed", action: input.action, trace };
    }
    throw new ChromeActionError("ACTION_NOT_SUPPORTED", "The requested Chrome DevTools action is not supported.");
  }
}

export function createChromeController(env: NodeJS.ProcessEnv = process.env): ChromeController {
  return new ChromeController(env);
}
