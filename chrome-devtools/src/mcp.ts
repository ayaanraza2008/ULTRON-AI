import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createChromeController } from "./controller.js";
import { ChromeActionError } from "./security.js";

const controller = createChromeController();
const server = new McpServer({
  name: "ultron-chrome-devtools",
  version: "1.0.0"
});

type ToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

async function invoke(input: Record<string, unknown>) {
  try {
    const result = await controller.execute(input);
    if (typeof result.imageBase64 === "string") {
      const imageBase64 = result.imageBase64;
      const mimeType = typeof result.mimeType === "string" ? result.mimeType : "image/jpeg";
      const summary = { ...result };
      delete summary.imageBase64;
      return {
        content: [
          { type: "text", text: JSON.stringify(summary) } satisfies ToolContent,
          { type: "image", data: imageBase64, mimeType } satisfies ToolContent
        ]
      };
    }
    return { content: [{ type: "text", text: JSON.stringify(result) } satisfies ToolContent] };
  } catch (error) {
    const code = error instanceof ChromeActionError ? error.code : "CHROME_ACTION_FAILED";
    const message = error instanceof Error ? error.message : "Chrome DevTools action failed.";
    return { isError: true, content: [{ type: "text", text: JSON.stringify({ code, message }) } satisfies ToolContent] };
  }
}

server.tool("chrome_status", "Check connection to the local Chrome DevTools endpoint and list open tab titles/URLs.", {}, async () => invoke({ action: "status" }));
server.tool("chrome_navigate", "Navigate the connected Chrome tab to an HTTPS public website or a loopback local development URL.", { url: z.string().min(1).max(2048) }, async ({ url }) => invoke({ action: "navigate", url }));
server.tool("chrome_click", "Click one uniquely matched element using a CSS/Playwright selector. External high-impact submissions remain confirmation-gated.", { selector: z.string().min(1).max(600), confirmExternalAction: z.boolean().optional() }, async ({ selector, confirmExternalAction }) => invoke({ action: "click", selector, confirmExternalAction }));
server.tool("chrome_fill", "Fill one uniquely matched form field. Password, token, one-time-code and payment fields are blocked.", { selector: z.string().min(1).max(600), text: z.string().max(5000) }, async ({ selector, text }) => invoke({ action: "fill", selector, text }));
server.tool("chrome_page_snapshot", "Read the page title, URL and bounded visible body text from the connected tab.", {}, async () => invoke({ action: "page_snapshot" }));
server.tool("chrome_screenshot", "Capture a bounded JPEG screenshot of the current Chrome tab and return it as an image.", {}, async () => invoke({ action: "screenshot" }));
server.tool("chrome_console_logs", "Read recent console messages and uncaught page errors; URLs are returned without query strings.", { limit: z.number().int().min(1).max(100).optional() }, async ({ limit }) => invoke({ action: "console_logs", limit }));
server.tool("chrome_network_requests", "Read recent network request metadata/statuses without request headers, cookies, bodies, or URL query strings.", { limit: z.number().int().min(1).max(100).optional() }, async ({ limit }) => invoke({ action: "network_requests", limit }));
server.tool("chrome_performance_trace", "Collect a short Chrome performance trace and return long trace events, metric deltas, and actionable hints.", { durationMs: z.number().int().min(1000).max(10000).optional() }, async ({ durationMs }) => invoke({ action: "performance_trace", durationMs }));

await server.connect(new StdioServerTransport());
