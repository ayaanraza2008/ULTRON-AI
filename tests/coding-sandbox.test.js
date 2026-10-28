import test from "node:test";
import assert from "node:assert/strict";
import { codingSandboxReadiness, extractExplicitSandboxRequest, hasExplicitSandboxAuthorization, runCodeInSandbox } from "../coding-sandbox.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const NODE_IMAGE = "registry.example/ultron-node:22@sha256:" + "a".repeat(64);
const PYTHON_IMAGE = "registry.example/ultron-python:3.12@sha256:" + "b".repeat(64);
const env = {
  ULTRON_CODING_SANDBOX_ENABLED: "true",
  ULTRON_INTEGRATION_OWNER_USER_ID: OWNER,
  ULTRON_CODING_SANDBOX_NODE_IMAGE: NODE_IMAGE,
  ULTRON_CODING_SANDBOX_PYTHON_IMAGE: PYTHON_IMAGE
};

function fakeDocker({ start = { stdout: "42\n", stderr: "" }, imageError = null, create = "a".repeat(64) } = {}) {
  const calls = [];
  const execFileImpl = async (binary, args, options) => {
    calls.push({ binary, args: [...args], options });
    if (args[0] === "image" && imageError) throw imageError;
    if (args[0] === "image") return { stdout: "[]", stderr: "" };
    if (args[0] === "create") return { stdout: create + "\n", stderr: "" };
    if (args[0] === "start") {
      if (start instanceof Error) throw start;
      return start;
    }
    if (args[0] === "kill") throw Object.assign(new Error("container already exited"), { code: 1 });
    if (args[0] === "rm") return { stdout: "", stderr: "" };
    throw new Error("Unexpected Docker command: " + args[0]);
  };
  return { calls, execFileImpl };
}

test("readiness defaults to blocked and accepts only configured digest-pinned runtimes", () => {
  assert.equal(codingSandboxReadiness({}).state, "blocked");
  assert.equal(codingSandboxReadiness({ ...env, ULTRON_CODING_SANDBOX_ENABLED: "false" }).configured, false);
  const valid = codingSandboxReadiness(env);
  assert.equal(valid.state, "configured_unverified");
  assert.deepEqual(valid.languages.sort(), ["node", "python"]);
  assert.equal(codingSandboxReadiness({ ...env, ULTRON_CODING_SANDBOX_NODE_IMAGE: "node:latest", ULTRON_CODING_SANDBOX_PYTHON_IMAGE: "" }).configured, false);
});

test("execution requires a direct request and exact code from the current prompt", () => {
  const fence = String.fromCharCode(96).repeat(3);
  const prompt = "Please run this code:\n" + fence + "python\nprint(6 * 7)\n" + fence;
  assert.equal(hasExplicitSandboxAuthorization(prompt, "print(6 * 7)", "python"), true);
  const languagePrompt = "Please execute the Python code:\n" + fence + "python\nprint(6 * 7)\n" + fence;
  assert.equal(hasExplicitSandboxAuthorization(languagePrompt, "print(6 * 7)", "python"), true);
  assert.deepEqual(extractExplicitSandboxRequest(prompt), { language: "python", source: "print(6 * 7)" });
  assert.equal(extractExplicitSandboxRequest("How can I run Python code?"), null);
  assert.equal(hasExplicitSandboxAuthorization("How can I run Python code?", "print(6 * 7)", "python"), false);
  assert.equal(hasExplicitSandboxAuthorization("Write a Python script", "print(6 * 7)", "python"), false);
  assert.equal(hasExplicitSandboxAuthorization(prompt, "print(7 * 6)", "python"), false);
  assert.equal(hasExplicitSandboxAuthorization("Run the code you just generated above", "print(6 * 7)", "python"), false);

  const negatedBeforeFence = "Please run this code but do not execute it:\n" + fence + "python\nprint(6 * 7)\n" + fence;
  assert.equal(hasExplicitSandboxAuthorization(negatedBeforeFence, "print(6 * 7)", "python"), false);
  assert.equal(extractExplicitSandboxRequest(negatedBeforeFence), null);

  const negatedAfterFence = prompt + "\nActually, do not run it; explain it instead.";
  assert.equal(hasExplicitSandboxAuthorization(negatedAfterFence, "print(6 * 7)", "python"), false);
  assert.equal(extractExplicitSandboxRequest(negatedAfterFence), null);

  const stringLiteralSource = 'console.log("do not run this code")';
  const stringLiteralPrompt = "Please run this code:\n" + fence + "javascript\n" + stringLiteralSource + "\n" + fence;
  assert.equal(hasExplicitSandboxAuthorization(stringLiteralPrompt, stringLiteralSource, "node"), true);
  assert.equal(extractExplicitSandboxRequest("Run the code you just generated above"), null);
  assert.equal(hasExplicitSandboxAuthorization("Please run this code:\n" + fence + "bash\nrm -rf /\n" + fence, "print(6 * 7)", "python"), false);
});

test("non-owner, disabled, unsupported-language and oversized requests never invoke Docker", async () => {
  const fake = fakeDocker();
  const other = await runCodeInSandbox({ env, userId: "00000000-0000-4000-8000-000000000002", language: "node", source: "console.log(1)", execFileImpl: fake.execFileImpl });
  const disabled = await runCodeInSandbox({ env: { ...env, ULTRON_CODING_SANDBOX_ENABLED: "false" }, userId: OWNER, language: "node", source: "console.log(1)", execFileImpl: fake.execFileImpl });
  const unsupported = await runCodeInSandbox({ env, userId: OWNER, language: "bash", source: "echo no", execFileImpl: fake.execFileImpl });
  const oversized = await runCodeInSandbox({ env, userId: OWNER, language: "node", source: "x".repeat(20001), execFileImpl: fake.execFileImpl });
  assert.equal(other.code, "SANDBOX_OWNER_ONLY");
  assert.equal(disabled.code, "SANDBOX_DISABLED");
  assert.equal(unsupported.code, "SANDBOX_LANGUAGE_UNSUPPORTED");
  assert.equal(oversized.code, "SANDBOX_SOURCE_INVALID");
  assert.equal(fake.calls.length, 0);
});

test("container is networkless, read-only, resource bounded and never receives app env", async () => {
  const fake = fakeDocker();
  const result = await runCodeInSandbox({ env: { ...env, OPENROUTER_API_KEY: "must-not-leak" }, userId: OWNER, language: "node", source: "console.log(6 * 7)", execFileImpl: fake.execFileImpl });
  assert.equal(result.state, "completed");
  assert.equal(result.stdout, "42\n");
  assert.equal(result.execution, "restricted_local_container");
  assert.deepEqual(fake.calls[0].args, ["image", "inspect", NODE_IMAGE]);
  const create = fake.calls.find(call => call.args[0] === "create");
  for (const flag of ["--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges:true", "--pids-limit=48", "--memory=256m", "--memory-swap=256m", "--cpus=0.5", "--user=65534:65534", "--log-driver=none"]) assert.ok(create.args.includes(flag), "missing: " + flag);
  assert.equal(create.args.includes("--privileged"), false);
  assert.equal(create.args.includes("--env"), false);
  assert.equal(create.args.some(arg => arg.includes("docker.sock")), false);
  assert.equal(create.args.some(arg => arg === "--network=host"), false);
  assert.equal(create.args.includes("pull"), false);
  assert.ok(fake.calls.some(call => call.args[0] === "rm" && call.args[1] === "--force"));
});

test("Python uses isolated mode and disables bytecode output", async () => {
  const fake = fakeDocker();
  const result = await runCodeInSandbox({ env, userId: OWNER, language: "python", source: "print(42)", execFileImpl: fake.execFileImpl });
  assert.equal(result.state, "completed");
  const create = fake.calls.find(call => call.args[0] === "create");
  assert.ok(create.args.includes("python3"));
  assert.ok(create.args.includes("-I"));
  assert.ok(create.args.includes("-B"));
  assert.ok(create.args.includes("/workspace/main.py"));
});

test("missing cached image blocks execution and never runs Docker pull", async () => {
  const fake = fakeDocker({ imageError: Object.assign(new Error("not cached"), { code: 1 }) });
  const result = await runCodeInSandbox({ env, userId: OWNER, language: "node", source: "console.log(1)", execFileImpl: fake.execFileImpl });
  assert.equal(result.state, "blocked");
  assert.equal(result.code, "SANDBOX_RUNTIME_UNAVAILABLE");
  assert.equal(fake.calls.some(call => ["create", "start", "pull"].includes(call.args[0])), false);
});

test("timeout is reported honestly and the container is killed and removed", async () => {
  const err = Object.assign(new Error("timed out"), { code: "ETIMEDOUT", killed: true, signal: "SIGTERM", stdout: "partial" });
  const fake = fakeDocker({ start: err });
  const result = await runCodeInSandbox({ env, userId: OWNER, language: "node", source: "while (true) {}", execFileImpl: fake.execFileImpl });
  assert.equal(result.state, "timed_out");
  assert.equal(result.code, "SANDBOX_TIMEOUT");
  assert.ok(fake.calls.some(call => call.args[0] === "kill"));
  assert.ok(fake.calls.some(call => call.args[0] === "rm"));
});

test("non-zero exit is not labelled successful", async () => {
  const err = Object.assign(new Error("exit 2"), { code: 2, stdout: "", stderr: "ValueError\n" });
  const fake = fakeDocker({ start: err });
  const result = await runCodeInSandbox({ env, userId: OWNER, language: "python", source: "raise ValueError()", execFileImpl: fake.execFileImpl });
  assert.equal(result.state, "failed");
  assert.equal(result.success, false);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "ValueError\n");
});

test("output is truncated and source text is never passed in Docker arguments", async () => {
  const source = "console.log('not-in-argv')";
  const fake = fakeDocker({ start: { stdout: "x".repeat(20000), stderr: "" } });
  const result = await runCodeInSandbox({ env, userId: OWNER, language: "node", source, execFileImpl: fake.execFileImpl });
  const create = fake.calls.find(call => call.args[0] === "create");
  assert.equal(result.stdout.length, 16000);
  assert.equal(result.outputTruncated, true);
  assert.equal(create.args.join(" ").includes(source), false);
});
