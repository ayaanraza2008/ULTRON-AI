import test from "node:test";
import assert from "node:assert/strict";
import { UltronAutonomy, TASK_STATUS } from "../autonomy/ultron-autonomy.js";

test("UltronAutonomy: goal decomposition builds DAG with dependency links and sensitivity tags", () => {
  const engine = new UltronAutonomy();
  const plan = engine.decomposeGoal("Develop a new auth API and push code to production");

  assert.ok(plan.id.startsWith("plan-"));
  assert.equal(plan.subTasks.length, 4);

  // Step 1: Analyze repo
  const step1 = engine.getTask(plan.subTasks[0].id);
  assert.equal(step1.status, TASK_STATUS.READY);
  assert.equal(step1.dependsOn.length, 0);
  assert.equal(step1.sensitive, false);

  // Step 4: Push to production (sensitive action)
  const step4 = engine.getTask(plan.subTasks[3].id);
  assert.equal(step4.status, TASK_STATUS.PENDING);
  assert.ok(step4.dependsOn.includes(plan.subTasks[2].id));
  assert.equal(step4.sensitive, true);
});

test("UltronAutonomy: enforces dependency order before execution", async () => {
  const engine = new UltronAutonomy();
  const plan = engine.decomposeGoal("Research competitor models and synthesize report");

  const step2 = engine.getTask(plan.subTasks[1].id);
  // Attempting to run step 2 before step 1 must fail
  await assert.rejects(async () => {
    await engine.executeTask(step2.id);
  }, /Dependency .* is not completed/);
});

test("UltronAutonomy: full plan execution halts at human approval gate and resumes after token approval", async () => {
  const engine = new UltronAutonomy();
  const plan = engine.decomposeGoal("Develop code feature and push to production");

  // Run plan up to the sensitive gate
  const initialRun = await engine.runPlan(plan.id);

  // Step 1, 2, 3 should be completed
  assert.equal(engine.getTask(plan.subTasks[0].id).status, TASK_STATUS.COMPLETED);
  assert.equal(engine.getTask(plan.subTasks[1].id).status, TASK_STATUS.COMPLETED);
  assert.equal(engine.getTask(plan.subTasks[2].id).status, TASK_STATUS.COMPLETED);

  // Step 4 is sensitive and requires human approval
  const step4 = engine.getTask(plan.subTasks[3].id);
  assert.equal(step4.status, TASK_STATUS.APPROVAL_REQUIRED);

  const req = engine.approvalRequests.get(step4.id);
  assert.ok(req);
  assert.ok(req.token.startsWith("appr_"));

  // Rejecting with wrong token fails
  assert.throws(() => {
    engine.submitApproval(step4.id, "wrong_token", true);
  }, /Invalid cryptographic approval token/);

  // Approving with correct token transitions task to READY
  const approvalRes = engine.submitApproval(step4.id, req.token, true);
  assert.equal(approvalRes.status, TASK_STATUS.READY);

  // Now resume and finish plan
  const finalRun = await engine.runPlan(plan.id);
  assert.equal(step4.status, TASK_STATUS.COMPLETED);
  assert.equal(plan.status, TASK_STATUS.COMPLETED);
});

test("UltronAutonomy: failure detection triggers retry with backoff and marks failed when limit exceeded", async () => {
  const engine = new UltronAutonomy({ maxRetries: 2 });
  const plan = engine.decomposeGoal("Research topic");
  const step1 = engine.getTask(plan.subTasks[0].id);

  let attempts = 0;
  const failingExecutor = async () => {
    attempts++;
    throw new Error("Transient network timeout");
  };

  // Attempt 1 -> will retry
  const res1 = await engine.executeTask(step1.id, failingExecutor);
  assert.equal(res1.recovered, true);
  assert.equal(step1.status, TASK_STATUS.READY);

  // Attempt 2 -> exceeds limit, marks FAILED
  const res2 = await engine.executeTask(step1.id, failingExecutor);
  assert.equal(step1.status, TASK_STATUS.FAILED);
  assert.equal(attempts, 2);
});

test("UltronAutonomy: verification gate validates structured task results", async () => {
  const engine = new UltronAutonomy();
  const plan = engine.decomposeGoal("Research topic");
  const step1 = engine.getTask(plan.subTasks[0].id);

  // Executor returning invalid unstructured result fails verification
  await engine.executeTask(step1.id, async () => "raw_string_unstructured");
  // It caught verification failure and scheduled retry
  assert.equal(step1.status, TASK_STATUS.READY);
  assert.ok(step1.error.includes("verification failed"));

  // Valid structured result succeeds verification
  await engine.executeTask(step1.id, async () => ({
    success: true,
    data: "Validated research findings"
  }));
  assert.equal(step1.status, TASK_STATUS.COMPLETED);
  assert.equal(step1.verification.verified, true);
});
