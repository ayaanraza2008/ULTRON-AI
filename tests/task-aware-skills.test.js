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
