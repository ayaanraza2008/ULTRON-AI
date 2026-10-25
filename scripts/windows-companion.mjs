import { runWindowsCompanion } from "../desktop-companion/windows-agent.js";

if (process.platform !== "win32") {
  console.error("ULTRON Windows companion must run on Windows.");
  process.exitCode = 1;
} else {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await runWindowsCompanion({ signal: controller.signal });
  } catch (error) {
    // Never print environment variables, response bodies, or provider credentials.
    console.error("ULTRON Windows companion stopped:", typeof error?.code === "string"
      ? error.code.slice(0, 80)
      : "DESKTOP_COMPANION_START_FAILED");
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
