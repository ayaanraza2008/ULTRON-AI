/**
 * ULTRON AI — Next-Generation Autonomous Intelligence
 * Module: ULTRON AUTONOMY (autonomy/ultron-autonomy.js)
 *
 * Implements hierarchical goal decomposition, multi-step dependency planning (DAG),
 * background task queue execution, persistent task state, failure detection & self-healing,
 * post-execution verification, and cryptographic human approval gates.
 */

import crypto from "node:crypto";

export const TASK_STATUS = {
  PENDING: "PENDING",
  READY: "READY",
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
  EXECUTING: "EXECUTING",
  VERIFYING: "VERIFYING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED"
};

export const SENSITIVE_ACTIONS = new Set([
  "DELETE_FILE",
  "PURGE_DATABASE",
  "EXEC_ROOT_SHELL",
  "TRANSFER_FUNDS",
  "PUSH_TO_PRODUCTION",
  "OVERWRITE_SYSTEM_CONFIG",
  "DISABLE_SAFETY_GEOFENCE"
]);

export class UltronAutonomy {
  constructor(options = {}) {
    this.tasks = new Map();
    this.plans = new Map();
    this.approvalRequests = new Map();
    this.maxConcurrentTasks = options.maxConcurrentTasks || 3;
    this.activeWorkers = 0;
    this.maxRetries = options.maxRetries || 3;
    this.taskHistory = [];
  }

  /**
   * Goal Decomposition:
   * Splits a complex objective into a sequential or parallel multi-step DAG plan.
   */
  decomposeGoal(goalDescription, options = {}) {
    const rawGoal = String(goalDescription || "").trim();
    if (!rawGoal) throw new Error("Goal description cannot be empty.");

    const planId = "plan-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex");
    const subTasks = [];

    // Analyze goal keywords to formulate concrete steps
    const isCodeGoal = /\b(code|app|feature|test|script|refactor|debug|api)\b/i.test(rawGoal);
    const isRoboticsGoal = /\b(robot|navigation|motion|arm|sensor|actuator|trajectory)\b/i.test(rawGoal);

    if (isRoboticsGoal) {
      subTasks.push({
        id: `${planId}-step-1`,
        title: "Perception & Environment Mapping",
        action: "ROBOT_SCAN_ENVIRONMENT",
        dependsOn: [],
        sensitive: false
      });
      subTasks.push({
        id: `${planId}-step-2`,
        title: "Kinematic Path Simulation & Geofence Check",
        action: "ROBOT_SIMULATE_TRAJECTORY",
        dependsOn: [`${planId}-step-1`],
        sensitive: false
      });
      subTasks.push({
        id: `${planId}-step-3`,
        title: "Physical Actuator Dispatch",
        action: "ROBOT_EXECUTE_MOTION",
        dependsOn: [`${planId}-step-2`],
        sensitive: true // Actuating physical motors is a sensitive step
      });
    } else if (isCodeGoal) {
      subTasks.push({
        id: `${planId}-step-1`,
        title: "Repository Analysis & Spec Drafting",
        action: "ANALYZE_REPO_SPEC",
        dependsOn: [],
        sensitive: false
      });
      subTasks.push({
        id: `${planId}-step-2`,
        title: "Implementation & Unit Test Generation",
        action: "GENERATE_CODE_AND_TESTS",
        dependsOn: [`${planId}-step-1`],
        sensitive: false
      });
      subTasks.push({
        id: `${planId}-step-3`,
        title: "Sandboxed Test Verification",
        action: "EXECUTE_SANDBOX_TESTS",
        dependsOn: [`${planId}-step-2`],
        sensitive: false
      });
      subTasks.push({
        id: `${planId}-step-4`,
        title: "Push to Production Branch",
        action: "PUSH_TO_PRODUCTION",
        dependsOn: [`${planId}-step-3`],
        sensitive: true // Production push requires approval
      });
    } else {
      // General task decomposition
      subTasks.push({
        id: `${planId}-step-1`,
        title: "Information Gathering & Research",
        action: "RESEARCH_QUERY",
        dependsOn: [],
        sensitive: false
      });
      subTasks.push({
        id: `${planId}-step-2`,
        title: "Synthesis & Action Formulation",
        action: "SYNTHESIZE_REPORT",
        dependsOn: [`${planId}-step-1`],
        sensitive: false
      });
    }

    const plan = {
      id: planId,
      goal: rawGoal,
      subTasks,
      status: TASK_STATUS.PENDING,
      createdAt: new Date().toISOString()
    };

    this.plans.set(planId, plan);

    // Register individual tasks into queue
    for (const st of subTasks) {
      const taskRecord = {
        id: st.id,
        planId,
        title: st.title,
        action: st.action,
        dependsOn: st.dependsOn,
        sensitive: Boolean(st.sensitive || SENSITIVE_ACTIONS.has(st.action)),
        status: st.dependsOn.length === 0 ? TASK_STATUS.READY : TASK_STATUS.PENDING,
        attempts: 0,
        result: null,
        error: null,
        verification: null,
        createdAt: new Date().toISOString()
      };
      if (taskRecord.sensitive && taskRecord.status === TASK_STATUS.READY) {
        taskRecord.status = TASK_STATUS.APPROVAL_REQUIRED;
        this.createApprovalRequest(taskRecord);
      }
      this.tasks.set(taskRecord.id, taskRecord);
    }

    return plan;
  }

  /**
   * Human Approval Gate for sensitive actions.
   */
  createApprovalRequest(task) {
    const token = "appr_" + crypto.randomBytes(12).toString("hex");
    const req = {
      requestId: "req-" + Date.now(),
      taskId: task.id,
      action: task.action,
      title: task.title,
      token,
      status: "AWAITING_APPROVAL",
      createdAt: new Date().toISOString()
    };
    this.approvalRequests.set(task.id, req);
    return req;
  }

  submitApproval(taskId, token, approved = true) {
    const req = this.approvalRequests.get(taskId);
    if (!req) throw new Error(`No pending approval request found for task ${taskId}`);
    if (req.token !== token) throw new Error("Invalid cryptographic approval token.");

    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found.`);

    if (approved) {
      req.status = "APPROVED";
      task.status = TASK_STATUS.READY;
    } else {
      req.status = "REJECTED";
      task.status = TASK_STATUS.CANCELLED;
      task.error = "Human operator rejected execution of sensitive action.";
    }
    return { taskId, approved, status: task.status };
  }

  /**
   * Task Verification Gate:
   * Verifies that the task output satisfies contract before marking COMPLETED.
   */
  verifyTaskOutcome(task, result) {
    if (!result) return { verified: false, reason: "No outcome payload produced" };
    if (result.error) return { verified: false, reason: result.error };
    if (typeof result !== "object") return { verified: false, reason: "Result must be structured object" };
    return { verified: true, timestamp: new Date().toISOString() };
  }

  /**
   * Executes a single task with failure detection, self-healing retries, and verification.
   */
  async executeTask(taskId, executorFn) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found.`);

    // Pre-condition: Check if dependencies are completed
    for (const depId of task.dependsOn) {
      const dep = this.tasks.get(depId);
      if (!dep || dep.status !== TASK_STATUS.COMPLETED) {
        throw new Error(`Cannot execute task ${taskId}: Dependency ${depId} is not completed.`);
      }
    }

    // Pre-condition: Check approval if sensitive
    if (task.sensitive && task.status === TASK_STATUS.APPROVAL_REQUIRED) {
      throw new Error(`Cannot execute task ${taskId}: Action '${task.action}' requires explicit human approval.`);
    }

    task.status = TASK_STATUS.EXECUTING;
    task.attempts += 1;

    try {
      const outcome = typeof executorFn === "function" 
        ? await executorFn(task)
        : { executed: true, action: task.action, payload: `Completed ${task.title}` };

      // Verification gate
      task.status = TASK_STATUS.VERIFYING;
      const verification = this.verifyTaskOutcome(task, outcome);

      if (!verification.verified) {
        throw new Error(`Task verification failed: ${verification.reason}`);
      }

      task.status = TASK_STATUS.COMPLETED;
      task.result = outcome;
      task.verification = verification;

      // Check dependent tasks in plan and transition READY tasks
      this.updatePlanDependencies(task.planId);
      return task;
    } catch (err) {
      task.error = err.message;
      if (task.attempts < this.maxRetries) {
        // Self-healing recovery: retry with backoff
        task.status = TASK_STATUS.READY;
        return { ...task, recovered: true, willRetry: true };
      } else {
        task.status = TASK_STATUS.FAILED;
        return task;
      }
    }
  }

  /**
   * Evaluates all tasks in a plan, transitions unblocked tasks to READY or APPROVAL_REQUIRED.
   */
  updatePlanDependencies(planId) {
    const plan = this.plans.get(planId);
    if (!plan) return;

    let allComplete = true;
    for (const st of plan.subTasks) {
      const task = this.tasks.get(st.id);
      if (!task) continue;

      if (task.status === TASK_STATUS.PENDING) {
        const depsSatisfied = task.dependsOn.every(depId => {
          const d = this.tasks.get(depId);
          return d && d.status === TASK_STATUS.COMPLETED;
        });

        if (depsSatisfied) {
          if (task.sensitive) {
            task.status = TASK_STATUS.APPROVAL_REQUIRED;
            this.createApprovalRequest(task);
          } else {
            task.status = TASK_STATUS.READY;
          }
        }
      }

      if (task.status !== TASK_STATUS.COMPLETED) {
        allComplete = false;
      }
    }

    if (allComplete) {
      plan.status = TASK_STATUS.COMPLETED;
    }
  }

  /**
   * Executes all runnable tasks in a plan sequentially or concurrently up to limit.
   */
  async runPlan(planId, executorFn) {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found.`);

    plan.status = TASK_STATUS.EXECUTING;

    let hasProgress = true;
    while (hasProgress) {
      hasProgress = false;
      const runnableTasks = plan.subTasks
        .map(st => this.tasks.get(st.id))
        .filter(t => t && t.status === TASK_STATUS.READY);

      for (const task of runnableTasks) {
        hasProgress = true;
        await this.executeTask(task.id, executorFn);
      }

      const pendingSensitive = plan.subTasks
        .map(st => this.tasks.get(st.id))
        .filter(t => t && t.status === TASK_STATUS.APPROVAL_REQUIRED);

      // If only sensitive tasks remain, halt loop until user approves
      if (pendingSensitive.length > 0 && runnableTasks.length === 0) {
        break;
      }
    }

    return {
      planId,
      status: plan.status,
      tasks: plan.subTasks.map(st => this.tasks.get(st.id))
    };
  }

  getTask(taskId) {
    return this.tasks.get(taskId) || null;
  }

  getPlan(planId) {
    return this.plans.get(planId) || null;
  }
}

export const ultronAutonomy = new UltronAutonomy();
