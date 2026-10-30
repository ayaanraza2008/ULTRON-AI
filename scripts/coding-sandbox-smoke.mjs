import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runCodeInSandbox } from "../coding-sandbox.js";

const exec = promisify(execFile);
const ownerId = "00000000-0000-4000-8000-000000000001";
const image = process.env.ULTRON_CODING_SANDBOX_PYTHON_IMAGE || "";
assert.match(image, /^python:3\.12-alpine@sha256:[a-f0-9]{64}$/i,
  "CI must supply the immutable official Python image manifest digest");

const env = {
  ...process.env,
  ULTRON_CODING_SANDBOX_ENABLED: "true",
  ULTRON_INTEGRATION_OWNER_USER_ID: ownerId,
  ULTRON_CODING_SANDBOX_PYTHON_IMAGE: image,
  ULTRON_CODING_SANDBOX_TIMEOUT_MS: "8000"
};
const calls = [];
let containerId = "";

const source = [
  "import os, socket, subprocess",
  "assert os.getuid() == 65534, f'unexpected uid: {os.getuid()}'",
  "print('ULTRON_DOCKER_NON_ROOT_OK')",
  "try:",
  "    open('/workspace/main.py', 'a', encoding='utf-8').write('\\n# write-probe')",
  "    raise AssertionError('source bind mount is writable')",
  "except OSError:",
  "    print('ULTRON_DOCKER_SOURCE_READONLY_OK')",
  "try:",
  "    with socket.create_connection(('1.1.1.1', 53), timeout=1):",
  "        raise AssertionError('container unexpectedly has outbound network access')",
  "except OSError:",
  "    print('ULTRON_DOCKER_NETWORK_DISABLED_OK')",
  "probe = '/tmp/ultron-noexec-probe'",
  "with open(probe, 'w', encoding='utf-8') as handle:",
  "    handle.write('#!/bin/sh\\nexit 0\\n')",
  "os.chmod(probe, 0o755)",
  "try:",
  "    subprocess.run([probe], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)",
  "    raise AssertionError('/tmp unexpectedly permits execution')",
  "except PermissionError:",
  "    print('ULTRON_DOCKER_TMP_NOEXEC_OK')"
].join("\n");

const execFileImpl = async (bin, args, options) => {
  calls.push([...args]);
  const result = await exec(bin, args, options);
  if (args[0] === "create") {
    containerId = String(result.stdout || "").trim();
    assert.match(containerId, /^[a-f0-9]{12,64}$/i, "Docker must create a real container");
    const inspected = await exec(bin, ["inspect", containerId], { encoding: "utf8", windowsHide: true, timeout: 3000 });
    const details = JSON.parse(inspected.stdout)[0];
    assert.equal(details.Config.User, "65534:65534");
    assert.equal(details.HostConfig.ReadonlyRootfs, true);
    assert.equal(details.HostConfig.NetworkMode, "none");
    assert.deepEqual(details.HostConfig.CapDrop, ["ALL"]);
    assert.ok(details.HostConfig.SecurityOpt.includes("no-new-privileges:true"));
    assert.equal(details.Mounts.length, 1);
    assert.equal(details.Mounts[0].Destination, "/workspace");
    assert.equal(details.Mounts[0].RW, false);
    const tmpfs = details.HostConfig.Tmpfs?.["/tmp"] || "";
    assert.match(tmpfs, /noexec/);
    assert.match(tmpfs, /nosuid/);
    assert.match(tmpfs, /nodev/);
  }
  return result;
};

const result = await runCodeInSandbox({
  env,
  userId: ownerId,
  language: "python",
  source,
  execFileImpl
});

assert.equal(result.state, "completed", JSON.stringify(result));
assert.equal(result.success, true);
for (const marker of [
  "ULTRON_DOCKER_NON_ROOT_OK",
  "ULTRON_DOCKER_SOURCE_READONLY_OK",
  "ULTRON_DOCKER_NETWORK_DISABLED_OK",
  "ULTRON_DOCKER_TMP_NOEXEC_OK"
]) {
  assert.ok(result.stdout.includes(marker), "Missing real-container assertion: " + marker);
}
assert.ok(calls.some(args => args[0] === "create"));
assert.ok(calls.some(args => args[0] === "start"));
assert.ok(calls.some(args => args[0] === "kill"));
assert.ok(calls.some(args => args[0] === "rm"));
assert.ok(containerId);

await assert.rejects(
  exec("docker", ["inspect", containerId], { encoding: "utf8", windowsHide: true, timeout: 3000 }),
  "sandbox container should be removed after execution"
);

console.log("Real Docker sandbox smoke passed: non-root UID, read-only source mount, no network, noexec/nosuid/nodev tmpfs, hardened container config, and container cleanup.");
