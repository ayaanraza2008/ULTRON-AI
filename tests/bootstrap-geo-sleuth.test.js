import test from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureGeoSleuthRuntime } from "../scripts/bootstrap-geo-sleuth.mjs";

test("Geo-Sleuth bootstrap is a no-op when integration is disabled", async () => {
  let invoked = false;
  const result = await ensureGeoSleuthRuntime({ env: {}, runCommand: async () => { invoked = true; } });
  assert.deepEqual(result, { state: "disabled" });
  assert.equal(invoked, false);
});

test("Geo-Sleuth bootstrap reuses a complete pinned runtime without network calls", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "ultron-geo-bootstrap-"));
  const root = path.join(base, "skills", "geo-sleuth");
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await writeFile(path.join(root, "scripts", "intake.py"), "# fixture");
  await writeFile(path.join(root, "scripts", "board.py"), "# fixture");
  let invoked = false;
  try {
    const result = await ensureGeoSleuthRuntime({
      env: { GEO_SLEUTH_ENABLED: "true", GEO_SLEUTH_ROOT: root },
      runCommand: async () => { invoked = true; }
    });
    assert.equal(result.state, "source_present");
    assert.equal(result.root, root);
    assert.equal(invoked, false);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Geo-Sleuth bootstrap downloads a pinned uv release installer with HTTPS-only curl policy", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "ultron-geo-bootstrap-install-"));
  const root = path.join(base, "repository", "skills", "geo-sleuth");
  const calls = [];
  try {
    const result = await ensureGeoSleuthRuntime({
      env: { GEO_SLEUTH_ENABLED: "true", GEO_SLEUTH_ROOT: root },
      uvInstallerSha256: createHash("sha256").update("# installer fixture").digest("hex"),
      log() {},
      runCommand: async (command, args) => {
        calls.push({ command, args });
        if (command === "git" && args[0] === "clone") {
          const clonePath = args.at(-1);
          const scripts = path.join(clonePath, "skills", "geo-sleuth", "scripts");
          await mkdir(scripts, { recursive: true });
          await writeFile(path.join(scripts, "intake.py"), "# pinned fixture");
          await writeFile(path.join(scripts, "board.py"), "# pinned fixture");
          return {};
        }
        if (command === "uv" || command.endsWith(path.join(".local", "bin", "uv"))) {
          throw new Error("uv is not installed");
        }
        if (command === "curl") {
          assert.deepEqual(args.slice(0, 7), ["--proto", "=https", "--proto-redir", "=https", "--tlsv1.2", "--max-time", "30"]);
          assert.equal(args[7], "--max-filesize");
          assert.equal(args[8], "1048576");
          const urlIndex = args.indexOf("https://releases.astral.sh/github/uv/releases/download/0.13.5/uv-installer.sh");
          assert.ok(urlIndex > 0);
          assert.equal(args[urlIndex - 1], "-LsSf");
          const outputIndex = args.indexOf("-o");
          assert.ok(outputIndex > -1);
          await writeFile(args[outputIndex + 1], "# installer fixture");
          return {};
        }
        if (command === "sh") {
          assert.match(args[0], /ultron-uv-installer-[^/]+[/\\]uv-installer\.sh$/);
          return {};
        }
        if (command === "git") return {};
        throw new Error("Unexpected command: " + command);
      }
    });
    assert.equal(result.state, "source_present");
    const curlCall = calls.find(call => call.command === "curl");
    assert.ok(curlCall, "installer download should be attempted when uv is absent");
    assert.ok(calls.some(call => call.command === "sh"), "downloaded installer should be invoked after download");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Geo-Sleuth bootstrap never executes an installer whose checksum does not match", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "ultron-geo-bootstrap-bad-installer-"));
  const root = path.join(base, "repository", "skills", "geo-sleuth");
  const commands = [];
  try {
    const result = await ensureGeoSleuthRuntime({
      env: { GEO_SLEUTH_ENABLED: "true", GEO_SLEUTH_ROOT: root },
      log() {},
      runCommand: async (command, args) => {
        commands.push({ command, args });
        if (command === "git" && args[0] === "clone") {
          const clonePath = args.at(-1);
          const scripts = path.join(clonePath, "skills", "geo-sleuth", "scripts");
          await mkdir(scripts, { recursive: true });
          await writeFile(path.join(scripts, "intake.py"), "# fixture");
          await writeFile(path.join(scripts, "board.py"), "# fixture");
          return {};
        }
        if (command === "uv" || command.endsWith(path.join(".local", "bin", "uv"))) throw new Error("not installed");
        if (command === "curl") {
          await writeFile(args[args.indexOf("-o") + 1], "# tampered installer");
          return {};
        }
        if (command === "git") return {};
        throw new Error("Unexpected command: " + command);
      }
    });
    assert.equal(result.state, "source_present_uv_missing");
    assert.equal(commands.some(call => call.command === "sh"), false);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
