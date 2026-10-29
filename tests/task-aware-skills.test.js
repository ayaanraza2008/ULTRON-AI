import test from "node:test";
import assert from "node:assert/strict";
import { buildTaskSkillsGuidance } from "../task-aware-skills.js";

test("task-aware skills selects software, research and multi-step guidance from natural language", () => {
  const result = buildTaskSkillsGuidance("Research current sources and implement a repository integration with tests");
  assert.ok(result.categories.includes("software_change"));
  assert.ok(result.categories.includes("research"));
  assert.ok(result.categories.includes("multi_step"));
});

test("task-aware skills selects defensive cybersecurity references only for relevant tasks", () => {
  const security = buildTaskSkillsGuidance("Audit this API for SQL injection and prompt injection vulnerabilities");
  assert.ok(security.securitySkills.length > 0);
  assert.ok(security.rules.some(rule => rule.includes("Defensive security guidance")));
  const ordinary = buildTaskSkillsGuidance("Write a birthday message");
  assert.equal(ordinary.securitySkills.length, 0);
});

test("task-aware skills infers diagram type and scientific workflow", () => {
  const diagram = buildTaskSkillsGuidance("Create a sequence diagram for the authentication API");
  assert.equal(diagram.diagramRequested, true);
  assert.equal(diagram.diagramType, "sequence");
  const science = buildTaskSkillsGuidance("Run statistical analysis on this experiment dataset and calculate confidence intervals");
  assert.equal(science.scientificTask, true);
  assert.ok(science.scienceSkills.some(skill => skill.name === "statistical-analysis"));
});

test("consequential tasks are classified but never granted execution permission", () => {
  const result = buildTaskSkillsGuidance("Send an email and delete the old records");
  assert.ok(result.categories.includes("consequential_action"));
  assert.ok(result.rules.some(rule => rule.includes("do not execute side effects")));
});

test("ECC guidance is selected automatically for backend implementation tasks and uses a pinned upstream revision", () => {
  const result = buildTaskSkillsGuidance("Implement a backend API integration with tests");
  const names = result.eccSkills.map(skill => skill.name);
  assert.ok(names.includes("backend-patterns"));
  assert.ok(names.includes("tdd-workflow"));
  assert.ok(result.eccSkills.every(skill => skill.sourceUrl.includes("/ECC/blob/25278e7d7b6cf6e6a4e7a6c8e10f14ff22f0eb5b/")));
  assert.ok(result.rules.some(rule => rule.includes("ECC") && rule.includes("regression")));
  assert.ok(result.eccSkills.every(skill => typeof skill.content === "string" && skill.content.length > 0));
  assert.match(result.eccSkills.find(skill => skill.name === "backend-patterns").content, /Backend Development Patterns/);
});

test("ECC security and research skills are task-matched rather than injected into unrelated prompts", () => {
  const security = buildTaskSkillsGuidance("Review authentication, access control, and secret handling");
  assert.ok(security.eccSkills.some(skill => skill.name === "security-review"));
  const research = buildTaskSkillsGuidance("Research current provider options and compare evidence");
  assert.ok(research.eccSkills.some(skill => skill.name === "deep-research"));
  const ordinary = buildTaskSkillsGuidance("Write a birthday message");
  assert.equal(ordinary.eccSkills.length, 0);
});

test("ECC skill guidance remains locally useful and never removes consequential-action boundaries", () => {
  const result = buildTaskSkillsGuidance("Implement a workflow to send an email and delete old records");
  assert.ok(result.eccSkills.length > 0);
  assert.ok(result.rules.some(rule => rule.includes("explicit approval workflow")));
  assert.ok(result.rules.some(rule => rule.includes("task-specific approval")));
});

test("ECC auto-selection covers bug-fix phrasing and keeps security fixes paired with TDD", () => {
  const providerFix = buildTaskSkillsGuidance("Fix the backend provider fallback bug");
  assert.ok(providerFix.categories.includes("software_change"));
  assert.ok(providerFix.eccSkills.some(skill => skill.name === "backend-patterns"));
  assert.ok(providerFix.eccSkills.some(skill => skill.name === "tdd-workflow"));

  const securityFix = buildTaskSkillsGuidance("Fix the authentication API token-refresh vulnerability");
  const names = securityFix.eccSkills.map(skill => skill.name);
  assert.ok(names.includes("security-review"));
  assert.ok(names.includes("tdd-workflow"));
  assert.ok(!names.includes("backend-patterns"), "Keep security review and TDD as the two most relevant skills");
});

test("Build Your Own X references are selected only for relevant architecture/code tasks", () => {
  const relevant = buildTaskSkillsGuidance("Implement a RAG document search engine for ULTRON and expose it through an Express API endpoint with tests");
  assert.ok(relevant.buildYourOwnX);
  assert.ok(relevant.buildYourOwnX.matched.some(topic => topic.id === "ai-model"));
  assert.ok(relevant.rules.some(rule => rule.includes("Build-your-own-X reference selected")));
  assert.ok(relevant.rules.some(rule => rule.includes("regression tests")));

  const ordinary = buildTaskSkillsGuidance("Write a birthday message");
  assert.deepEqual(ordinary.buildYourOwnX.matched, []);
  assert.deepEqual(ordinary.buildYourOwnX.rules, []);
});
