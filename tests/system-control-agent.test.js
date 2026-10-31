import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SystemControlAgent, SYSTEM_PERMISSIONS, ALLOWED_APPS } from "../system/system-control-agent.js";

test("SystemControlAgent: Discovers connected storage drives", async () => {
  const agent = new SystemControlAgent();
  const drives = await agent.listDrives();

  assert.ok(Array.isArray(drives), "Drives should be an array");
  assert.ok(drives.length >= 1, "At least one drive should be detected");
  const primary = drives[0];
  assert.ok(primary.letter, "Drive must have a letter");
  assert.ok(primary.totalGB >= 0, "Drive must report total capacity");
  assert.ok(primary.type, "Drive must report drive type");
});

test("SystemControlAgent: Gathers comprehensive hardware vitals (CPU, RAM, GPU, storage)", async () => {
  const agent = new SystemControlAgent();
  const perf = await agent.getSystemPerformance();

  assert.ok(perf.cpu.model, "CPU model should be identified");
  assert.ok(perf.cpu.cores >= 1, "CPU cores should be >= 1");
  assert.ok(perf.memory.totalMB > 0, "Total RAM should be > 0");
  assert.ok(perf.memory.usagePercent >= 0 && perf.memory.usagePercent <= 100);
  assert.ok(perf.gpu.name, "GPU should be reported");
  assert.equal(perf.status, "HEALTHY");
});

test("SystemControlAgent: Searches files by query and extension safely", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ultron-search-test-"));
  const testFile1 = path.join(tmpDir, "sample_clip_sunset.mp4");
  const testFile2 = path.join(tmpDir, "document_project.pdf");
  const testFile3 = path.join(tmpDir, "notes.txt");

  await fs.writeFile(testFile1, "video-content");
  await fs.writeFile(testFile2, "pdf-content");
  await fs.writeFile(testFile3, "important secret keyword within text");

  const agent = new SystemControlAgent({ workspaceBase: tmpDir });

  // 1. Extension search
  const videos = await agent.searchFiles({ extension: "mp4", startDir: tmpDir });
  assert.equal(videos.length, 1);
  assert.equal(videos[0].name, "sample_clip_sunset.mp4");

  // 2. Query name search
  const projectFiles = await agent.searchFiles({ query: "project", startDir: tmpDir });
  assert.equal(projectFiles.length, 1);
  assert.equal(projectFiles[0].name, "document_project.pdf");

  // 3. Content pattern search
  const textMatches = await agent.searchFiles({ contentPattern: "important secret keyword", startDir: tmpDir });
  assert.equal(textMatches.length, 1);
  assert.equal(textMatches[0].name, "notes.txt");

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("SystemControlAgent: Organizes folders into categorized media subdirectories with automatic backup", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ultron-organize-test-"));
  const vidPath = path.join(tmpDir, "video1.mp4");
  const imgPath = path.join(tmpDir, "photo1.png");
  const docPath = path.join(tmpDir, "report1.pdf");
  const audPath = path.join(tmpDir, "track1.mp3");

  await fs.writeFile(vidPath, "video data");
  await fs.writeFile(imgPath, "image data");
  await fs.writeFile(docPath, "doc data");
  await fs.writeFile(audPath, "audio data");

  const agent = new SystemControlAgent({ workspaceBase: tmpDir });
  await agent.initialize();

  // Test dry run
  const dry = await agent.organizeFolder({ sourceDir: tmpDir, dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.fileCount, 4);

  // Test live organization with backup
  const outcome = await agent.organizeFolder({ sourceDir: tmpDir, dryRun: false });
  assert.equal(outcome.success, true);
  assert.equal(outcome.movedCount, 4);
  assert.ok(outcome.backupId, "Should create backup snapshot");

  // Verify organized subdirectories exist
  const videosExist = await fs.stat(path.join(tmpDir, "Videos", "video1.mp4"));
  const imagesExist = await fs.stat(path.join(tmpDir, "Images", "photo1.png"));
  const docsExist = await fs.stat(path.join(tmpDir, "Documents", "report1.pdf"));
  const audioExist = await fs.stat(path.join(tmpDir, "Audio", "track1.mp3"));

  assert.ok(videosExist.isFile());
  assert.ok(imagesExist.isFile());
  assert.ok(docsExist.isFile());
  assert.ok(audioExist.isFile());

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("SystemControlAgent: Security boundaries protect OS system directories and enforce Emergency Stop", async () => {
  const agent = new SystemControlAgent();

  // 1. Attempt to modify Windows protected directory must fail closed
  assert.throws(() => {
    agent.assertPathSafety("C:\\Windows\\System32\\calc.exe", SYSTEM_PERMISSIONS.WRITE);
  }, /ACCESS_DENIED/);

  assert.throws(() => {
    agent.assertPathSafety("C:\\Program Files\\app", SYSTEM_PERMISSIONS.DELETE);
  }, /ACCESS_DENIED/);

  // 2. Emergency stop halts all operations
  agent.setEmergencyStop(true);
  assert.equal(agent.isEmergencyStopped(), true);

  await assert.rejects(async () => {
    await agent.launchApp("notepad");
  }, /OPERATION_HALTED/);

  await assert.rejects(async () => {
    await agent.executeApprovedCommand("dir");
  }, /OPERATION_HALTED/);

  agent.setEmergencyStop(false);
});

test("SystemControlAgent: Application allowlist and command allowlist verification", async () => {
  const agent = new SystemControlAgent();

  // 1. Allowlisted app check
  assert.ok(ALLOWED_APPS.notepad);
  assert.ok(ALLOWED_APPS.browser);
  assert.ok(ALLOWED_APPS.terminal);

  // 2. Unapproved app fails
  await assert.rejects(async () => {
    await agent.launchApp("malicious_worm.exe");
  }, /APPLICATION_NOT_ALLOWLISTED/);

  // 3. Unapproved command fails
  await assert.rejects(async () => {
    await agent.executeApprovedCommand("format C: /y");
  }, /COMMAND_NOT_APPROVED/);

  // 4. Approved command succeeds
  const cmdResult = await agent.executeApprovedCommand("node --version");
  assert.equal(cmdResult.success, true);
  assert.ok(cmdResult.stdout.startsWith("v"));
});
