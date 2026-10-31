/**
 * ULTRON AI — fail-closed coding sandbox placeholder.
 *
 * A normal Node child process is not a security boundary: user code can still
 * access host files, process state, child processes, and network resources.
 * This adapter stays disabled until a separately provisioned OS/container
 * isolation runtime has been verified on the target host.
 */
export class CodingSandbox {
  constructor() {
    this.executionHistory = [];
    this.disabledReason = "CODE_SANDBOX_DISABLED: no verified OS-level isolation runtime is configured.";
  }

  async initialize() {
    return {
      ready: false,
      enabled: false,
      code: "CODE_SANDBOX_DISABLED",
      reason: this.disabledReason
    };
  }

  async executeJavaScript(_codeString) {
    return {
      language: "javascript",
      success: false,
      executed: false,
      timedOut: false,
      errorCode: "CODE_SANDBOX_DISABLED",
      error: this.disabledReason,
      stdout: "",
      stderr: ""
    };
  }

  getExecutionHistory(limit = 20) {
    return this.executionHistory.slice(-limit);
  }
}
