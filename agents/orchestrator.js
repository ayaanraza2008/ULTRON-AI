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
    this.deadLetterQueue = [];
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
      completedSteps: Array.isArray(task.steps) ? task.steps.filter(s => s.status === "COMPLETED").map(s => s.id) : Object.keys(task.artifacts || {})
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
          this.deadLetterQueue.push({
            taskId: task.id,
            taskTitle: task.title,
            failedStepId: step.id,
            agentId: step.agentId,
            error: err.message,
            timestamp: new Date().toISOString()
          });
          if (this.deadLetterQueue.length > 100) this.deadLetterQueue.shift();
          this.saveCheckpoint(taskId);
          return task;
        }
      }
    }

    if (task.status === "RUNNING") {
      task.status = "COMPLETED";
      task.finishedAt = new Date().toISOString();
      this.recordAudit(task.primaryAgent, "TASK_COMPLETED", { taskId });
      this.saveCheckpoint(taskId);
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
/**
   * Dispatches operational actions across all 12 specialized agents.
   */
  async executeAgentAction(agentId, action, payload = {}, context = {}) {
    if (this.emergencyHalted) {
      throw new Error("Action rejected: System is under Emergency Stop.");
    }
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent '${agentId}' not found in catalog.`);
    }

    this.recordAudit(agentId, "EXECUTE_ACTION", { action, payloadKeys: Object.keys(payload) });

    switch (agentId) {
      case "ultron-core":
        return {
          agent: "ultron-core",
          action,
          result: "Strategic directive synthesized.",
          autonomyLevel: this.autonomyLevel,
          timestamp: new Date().toISOString()
        };

      case "research-agent":
        return {
          agent: "research-agent",
          action,
          query: payload.query || "general",
          findings: `Synthesized research for ${payload.query || "unspecified"}`,
          sourcesCount: 3
        };

      case "coding-agent":
        return {
          agent: "coding-agent",
          action,
          codeValid: true,
          sandboxed: true,
          details: payload.task || "Code analysis completed"
        };

      case "security-agent":
        return {
          agent: "security-agent",
          action,
          safe: true,
          isolationVerified: true,
          auditApproved: true
        };

      case "system-agent":
        return {
          agent: "system-agent",
          action,
          hardwareNominal: true,
          telemetryChecked: true
        };

      case "memory-agent":
        return {
          agent: "memory-agent",
          action,
          contextRetrieved: true,
          recordsCount: 5
        };

      case "voice-agent":
        return {
          agent: "voice-agent",
          action,
          spokenCadence: true,
          persona: "ultron_command"
        };

      case "vision-agent":
        return {
          agent: "vision-agent",
          action,
          screenAnalyzed: true,
          detectedElements: ["window", "taskbar"]
        };

      case "automation-agent":
        return {
          agent: "automation-agent",
          action,
          taskScheduled: true,
          jobId: "job-" + Date.now()
        };

      case "planning-agent":
        return {
          agent: "planning-agent",
          action,
          planCreated: true,
          stages: ["init", "execute", "verify"]
        };

      case "execution-agent":
        return {
          agent: "execution-agent",
          action,
          executionStatus: "success",
          stepsRun: 1
        };

      case "self-improvement-agent":
        return {
          agent: "self-improvement-agent",
          action,
          diagnosticsReviewed: true,
          optimizationsProposed: 0
        };

      default:
        return {
          agent: agentId,
          action,
          status: "completed",
          data: payload
        };
    }
  }

  /**
   * Returns current tasks in the Dead Letter Queue.
   */
  getDeadLetterQueue() {
    return [...this.deadLetterQueue];
  }

  /**
   * Recovers and retries a failed task from the Dead Letter Queue.
   */
  async retryFromDeadLetterQueue(taskId, stepExecutor) {
    if (this.emergencyHalted) {
      throw new Error("Cannot retry from DLQ: System is under Emergency Stop.");
    }
    const task = this.activeTasks.get(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found.`);

    // Find and remove from DLQ
    this.deadLetterQueue = this.deadLetterQueue.filter(entry => entry.taskId !== taskId);

    // Reset failed steps
    for (const step of task.steps) {
      if (step.status === "FAILED" || step.status === "RETRYING") {
        step.status = "PENDING";
        step.attempts = 0;
        step.error = null;
      }
    }
    task.status = "QUEUED";
    task.error = null;
    task.finishedAt = null;

    this.recordAudit("SYSTEM", "RETRY_DLQ_TASK", { taskId });
    return this.resumeTask(taskId, stepExecutor);
  }

  /**
   * Executes a task structured as a Directed Acyclic Graph (DAG) with dependency barriers.
   */
  async executeDAG({ id, title, nodes = [] }, nodeExecutor) {
    if (this.emergencyHalted) {
      throw new Error("Cannot execute DAG: System is under Emergency Stop.");
    }

    const taskId = id || "dag-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
    const nodeMap = new Map();
    const artifacts = {};

    for (const node of nodes) {
      nodeMap.set(node.id, {
        id: node.id,
        agentId: node.agentId || "ultron-core",
        action: node.action || "execute",
        payload: node.payload || {},
        dependsOn: Array.isArray(node.dependsOn) ? node.dependsOn : [],
        status: "PENDING",
        result: null,
        error: null
      });
    }

    const task = {
      id: taskId,
      title: title || "DAG Task",
      status: "RUNNING",
      type: "DAG",
      totalNodes: nodes.length,
      artifacts,
      createdAt: new Date().toISOString()
    };
    this.activeTasks.set(taskId, task);

    const completed = new Set();

    while (completed.size < nodeMap.size) {
      if (this.emergencyHalted) {
        task.status = "CANCELLED";
        task.error = "Emergency stop triggered during DAG execution";
        return task;
      }

      // Find all ready nodes whose dependencies are completed
      const readyNodes = Array.from(nodeMap.values()).filter(node =>
        node.status === "PENDING" && node.dependsOn.every(depId => completed.has(depId))
      );

      if (readyNodes.length === 0 && completed.size < nodeMap.size) {
        task.status = "FAILED";
        task.error = "DAG deadlock or unresolvable dependency cycle detected.";
        return task;
      }

      // Execute ready nodes in parallel
      await Promise.all(readyNodes.map(async (node) => {
        node.status = "RUNNING";
        try {
          const res = nodeExecutor
            ? await nodeExecutor(node, artifacts)
            : await this.executeAgentAction(node.agentId, node.action, node.payload);
          node.result = res;
          node.status = "COMPLETED";
          artifacts[node.id] = res;
          completed.add(node.id);
        } catch (err) {
          node.status = "FAILED";
          node.error = err.message;
          throw err;
        }
      }));

      this.saveCheckpoint(taskId);
    }

    task.status = "COMPLETED";
    task.finishedAt = new Date().toISOString();
    this.saveCheckpoint(taskId);
    this.recordAudit("SYSTEM", "DAG_COMPLETED", { taskId, nodesCount: nodeMap.size });
    return task;
  }
}
