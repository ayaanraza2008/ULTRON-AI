/**
 * ULTRON AI — Multi-Agent Orchestrator
 *
 * Coordinates the 12 specialized agents with task decomposition,
 * inter-agent delegation, persistent checkpoints, automatic failure recovery,
 * exponential backoff, and emergency stop.
 */

import { getAgentById, ULTRON_AGENT_CATALOG } from "./catalog.js";

export class AgentOrchestrator {
  constructor(options = {}) {
    this.agents = new Map(ULTRON_AGENT_CATALOG.map(agent => [agent.id, agent]));
    this.activeTasks = new Map();
    this.checkpoints = new Map();
    this.auditLogs = [];
    this.emergencyHalted = false;
    this.autonomyLevel = options.defaultAutonomyLevel ?? 2;
    this.maxAuditLogs = 500;
  }

  setAutonomyLevel(level) {
    if (typeof level === "number" && level >= 0 && level <= 5) {
      this.autonomyLevel = level;
      this.recordAudit("SYSTEM", "SET_AUTONOMY_LEVEL", { level });
      return true;
    }
    return false;
  }

  getAutonomyLevel() {
    return this.autonomyLevel;
  }

  recordAudit(actor, action, details = {}) {
    const entry = {
      id: "audit-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      timestamp: new Date().toISOString(),
      actor,
      action,
      details
    };
    this.auditLogs.unshift(entry);
    if (this.auditLogs.length > this.maxAuditLogs) {
      this.auditLogs.pop();
    }
    return entry;
  }

  getAuditLogs(limit = 50) {
    return this.auditLogs.slice(0, limit);
  }

  /**
   * Emergency Stop / Kill Switch
   * Immediately terminates all active operations and halts agent loops.
   */
  emergencyStop(reason = "Operator invoked emergency stop") {
    this.emergencyHalted = true;
    const abortedTaskIds = [];

    for (const [taskId, task] of this.activeTasks.entries()) {
      if (task.status === "RUNNING" || task.status === "QUEUED") {
        task.status = "CANCELLED";
        task.error = "EMERGENCY_STOP_TRIGGERED: " + reason;
        task.finishedAt = new Date().toISOString();
        abortedTaskIds.push(taskId);
      }
    }

    this.recordAudit("SYSTEM", "EMERGENCY_STOP", { reason, abortedTasks: abortedTaskIds.length });
    return { success: true, reason, abortedTaskIds };
  }

  resetEmergencyStop() {
    this.emergencyHalted = false;
    this.recordAudit("SYSTEM", "RESET_EMERGENCY_STOP", {});
    return { success: true };
  }

  isHalted() {
    return this.emergencyHalted;
  }

  /**
   * Create an orchestrated task with checkpoints and steps.
   */
  createTask({ id, title, targetAgentId = "ultron-core", steps = [], input = {} }) {
    if (this.emergencyHalted) {
      throw new Error("Cannot create task: System is under Emergency Stop.");
    }

    const agent = this.agents.get(targetAgentId);
    if (!agent) {
      throw new Error(`Target agent '${targetAgentId}' not found in catalog.`);
    }

    const taskId = id || "task-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
    const task = {
      id: taskId,
      title: title || "Orchestrated Task",
      primaryAgent: targetAgentId,
      status: "QUEUED",
      currentStepIndex: 0,
      steps: steps.map((step, idx) => ({
        id: step.id || `step-${idx + 1}`,
        agentId: step.agentId || targetAgentId,
        action: step.action || "execute",
        payload: step.payload || {},
        status: "PENDING",
        attempts: 0,
        result: null,
        error: null
      })),
      input,
      artifacts: {},
      retryCount: 0,
      maxRetries: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: null
    };

    this.activeTasks.set(taskId, task);
    this.recordAudit(targetAgentId, "CREATE_TASK", { taskId, title });
    this.saveCheckpoint(taskId);
    return task;
  }

  saveCheckpoint(taskId) {
    const task = this.activeTasks.get(taskId);
    if (!task) return null;

    const checkpoint = {
      taskId: task.id,
      timestamp: new Date().toISOString(),
      currentStepIndex: task.currentStepIndex,
      status: task.status,
      artifacts: { ...task.artifacts },
      completedSteps: task.steps.filter(s => s.status === "COMPLETED").map(s => s.id)
    };

    this.checkpoints.set(taskId, checkpoint);
    return checkpoint;
  }

  getCheckpoint(taskId) {
    return this.checkpoints.get(taskId) || null;
  }

  /**
   * Resumes an interrupted task from its last recorded checkpoint.
   */
  async resumeTask(taskId, stepExecutor) {
    if (this.emergencyHalted) {
      throw new Error("Cannot resume task: System is under Emergency Stop.");
    }

    const task = this.activeTasks.get(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found.`);

    task.status = "RUNNING";
    this.recordAudit(task.primaryAgent, "RESUME_TASK", { taskId, fromStep: task.currentStepIndex });

    while (task.currentStepIndex < task.steps.length) {
      if (this.emergencyHalted) {
        task.status = "CANCELLED";
        task.error = "Emergency stop triggered during step execution";
        break;
      }

      const step = task.steps[task.currentStepIndex];
      if (step.status === "COMPLETED") {
        task.currentStepIndex += 1;
        continue;
      }

      step.status = "RUNNING";
      step.attempts += 1;

      try {
        const result = stepExecutor
          ? await stepExecutor(step, task)
          : { status: "success", executedAt: new Date().toISOString() };

        step.result = result;
        step.status = "COMPLETED";
        task.artifacts[step.id] = result;
        this.saveCheckpoint(taskId);
        task.currentStepIndex += 1;
      } catch (err) {
        step.error = err.message;
        if (step.attempts < task.maxRetries) {
          step.status = "RETRYING";
          const backoffMs = Math.min(1000 * Math.pow(2, step.attempts - 1), 8000);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        } else {
          step.status = "FAILED";
          task.status = "FAILED";
          task.error = `Step '${step.id}' failed after ${step.attempts} attempts: ${err.message}`;
          task.finishedAt = new Date().toISOString();
          this.recordAudit(step.agentId, "STEP_FAILED", { taskId, stepId: step.id, error: err.message });
          return task;
        }
      }
    }

    if (task.status === "RUNNING") {
      task.status = "COMPLETED";
      task.finishedAt = new Date().toISOString();
      this.recordAudit(task.primaryAgent, "TASK_COMPLETED", { taskId });
    }

    return task;
  }

  /**
   * Inter-Agent Delegation
   * One agent delegates a scoped sub-task to another specialized agent.
   */
  async delegate({ fromAgentId, toAgentId, taskName, input, executor }) {
    if (this.emergencyHalted) {
      throw new Error("Delegation rejected: Emergency stop is active.");
    }

    const source = this.agents.get(fromAgentId);
    const target = this.agents.get(toAgentId);

    if (!source || !target) {
      throw new Error(`Invalid delegation between '${fromAgentId}' and '${toAgentId}'.`);
    }

    this.recordAudit(fromAgentId, "DELEGATE_START", { toAgentId, taskName });

    const subtask = this.createTask({
      title: `[DELEGATED by ${source.name}] ${taskName}`,
      targetAgentId: toAgentId,
      steps: [{ id: "substep-1", agentId: toAgentId, action: "execute_delegation", payload: input }],
      input
    });

    const completed = await this.resumeTask(subtask.id, executor);
    this.recordAudit(toAgentId, "DELEGATE_FINISH", { fromAgentId, subtaskId: subtask.id, status: completed.status });
    return completed;
  }

  getTask(taskId) {
    return this.activeTasks.get(taskId) || null;
  }

  listTasks(status = null) {
    const all = Array.from(this.activeTasks.values());
    return status ? all.filter(t => t.status === status) : all;
  }
}
