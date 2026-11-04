/**
 * ULTRON AI — BYOX Distributed Task Lease & Worker Queue Engine
 *
 * Derived from Build Your Own X concepts:
 * - buildthingsuseful: Building Your Own Kafka-like System From Scratch
 * - AOSA: A Continuous Integration System
 * - greenvitriol: Build a Synchronization Engine with Node.js
 *
 * Implements lease-based task claiming with heartbeats, automatic lease reclamation,
 * idempotency deduplication, Dead-Letter Queue (DLQ) re-drive, and W3C distributed trace context.
 */

import crypto from 'crypto';

export class ByoxTaskLeaseWorker {
  constructor(options = {}) {
    this.leaseDurationMs = options.leaseDurationMs || 5000;
    this.maxRetries = options.maxRetries || 3;

    this.tasks = new Map(); // taskId -> Task
    this.idempotencyIndex = new Map(); // idempotencyKey -> taskId
    this.dlq = new Map(); // taskId -> DeadLetterTask
    this.completedTasks = new Map(); // taskId -> CompletedTask

    this.stats = {
      enqueued: 0,
      completed: 0,
      failed: 0,
      reclaimed: 0,
      redriven: 0
    };
  }

  /**
   * Generate a W3C-compliant traceparent string.
   */
  createTraceContext(parentTraceId = null) {
    const traceId = parentTraceId || crypto.randomBytes(16).toString('hex');
    const spanId = crypto.randomBytes(8).toString('hex');
    const traceparent = `00-${traceId}-${spanId}-01`;
    return { traceId, spanId, traceparent };
  }

  /**
   * Enqueue a new task for distributed processing.
   */
  enqueueTask(payload, options = {}) {
    const idempotencyKey = options.idempotencyKey;
    if (idempotencyKey && this.idempotencyIndex.has(idempotencyKey)) {
      const existingId = this.idempotencyIndex.get(idempotencyKey);
      return { taskId: existingId, status: 'DEDUPLICATED', task: this.getTask(existingId) };
    }

    const taskId = options.taskId || `task_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const traceContext = this.createTraceContext(options.parentTraceId);

    const task = {
      id: taskId,
      payload,
      status: 'PENDING',
      priority: options.priority || 1, // higher number = higher priority
      dependencies: Array.isArray(options.dependencies) ? options.dependencies : [],
      retries: 0,
      maxRetries: options.maxRetries || this.maxRetries,
      leaseWorkerId: null,
      leaseExpiresAt: null,
      createdAt: Date.now(),
      traceContext,
      idempotencyKey: idempotencyKey || null
    };

    this.tasks.set(taskId, task);
    if (idempotencyKey) {
      this.idempotencyIndex.set(idempotencyKey, taskId);
    }

    this.stats.enqueued++;
    return { taskId, status: 'ENQUEUED', task };
  }

  /**
   * Acquire a lease on the highest-priority pending or expired task.
   */
  acquireLease(workerId) {
    if (!workerId) {
      throw new Error('Worker ID required to acquire lease');
    }

    const now = Date.now();
    let bestCandidate = null;

    for (const task of this.tasks.values()) {
      const isPending = task.status === 'PENDING';
      const isExpired = task.status === 'RUNNING' && task.leaseExpiresAt && task.leaseExpiresAt < now;

      if (isExpired) {
        task.status = 'PENDING';
        task.leaseWorkerId = null;
        task.leaseExpiresAt = null;
        this.stats.reclaimed++;
      }

      const areDepsSatisfied = !task.dependencies || task.dependencies.length === 0 ||
        task.dependencies.every(depId => this.completedTasks.has(depId));

      if (task.status === 'PENDING' && areDepsSatisfied) {
        if (!bestCandidate || task.priority > bestCandidate.priority || 
           (task.priority === bestCandidate.priority && task.createdAt < bestCandidate.createdAt)) {
          bestCandidate = task;
        }
      }
    }

    if (!bestCandidate) {
      return null;
    }

    bestCandidate.status = 'RUNNING';
    bestCandidate.leaseWorkerId = workerId;
    bestCandidate.leaseExpiresAt = now + this.leaseDurationMs;

    return { ...bestCandidate };
  }

  /**
   * Worker heartbeat to renew an active lease.
   */
  renewLease(taskId, workerId) {
    const task = this.tasks.get(taskId);
    if (!task) return { success: false, reason: 'TASK_NOT_FOUND' };
    if (task.leaseWorkerId !== workerId) return { success: false, reason: 'WORKER_MISMATCH' };
    if (task.status !== 'RUNNING') return { success: false, reason: 'TASK_NOT_RUNNING' };

    task.leaseExpiresAt = Date.now() + this.leaseDurationMs;
    return { success: true, leaseExpiresAt: task.leaseExpiresAt };
  }

  /**
   * Mark a task as successfully completed.
   */
  completeTask(taskId, workerId, result = null) {
    const task = this.tasks.get(taskId);
    if (!task) return { success: false, reason: 'TASK_NOT_FOUND' };
    if (task.leaseWorkerId !== workerId) return { success: false, reason: 'WORKER_MISMATCH' };

    task.status = 'COMPLETED';
    task.result = result;
    task.completedAt = Date.now();

    this.completedTasks.set(taskId, task);
    this.tasks.delete(taskId);
    this.stats.completed++;

    return { success: true, taskId, durationMs: task.completedAt - task.createdAt };
  }

  /**
   * Fail a task; retry or move to Dead Letter Queue (DLQ).
   */
  failTask(taskId, workerId, error) {
    const task = this.tasks.get(taskId);
    if (!task) return { success: false, reason: 'TASK_NOT_FOUND' };
    if (task.leaseWorkerId !== workerId) return { success: false, reason: 'WORKER_MISMATCH' };

    task.retries++;
    const errorMessage = error?.message || String(error);

    if (task.retries < task.maxRetries) {
      // Return to PENDING for retry
      task.status = 'PENDING';
      task.leaseWorkerId = null;
      task.leaseExpiresAt = null;
      task.lastError = errorMessage;
      return { success: true, status: 'RETRY_SCHEDULED', retries: task.retries };
    }

    // Move to DLQ
    task.status = 'DEAD_LETTER';
    task.finalError = errorMessage;
    task.dlqTimestamp = Date.now();

    this.dlq.set(taskId, task);
    this.tasks.delete(taskId);
    this.stats.failed++;

    return { success: true, status: 'MOVED_TO_DLQ', taskId, error: errorMessage };
  }

  /**
   * Re-drive a dead-letter task back into the processing queue.
   */
  redriveDeadLetter(taskId) {
    const task = this.dlq.get(taskId);
    if (!task) {
      return { success: false, reason: 'NOT_FOUND_IN_DLQ' };
    }

    task.status = 'PENDING';
    task.retries = 0;
    task.leaseWorkerId = null;
    task.leaseExpiresAt = null;
    task.redrivenAt = Date.now();

    this.tasks.set(taskId, task);
    this.dlq.delete(taskId);
    this.stats.redriven++;

    return { success: true, taskId, status: 'REDRIVEN' };
  }

  /**
   * Cancel an active or pending task.
   */
  cancelTask(taskId, reason = 'USER_CANCELLED') {
    const task = this.tasks.get(taskId);
    if (!task) {
      if (this.completedTasks.has(taskId)) {
        return { success: false, reason: 'ALREADY_COMPLETED' };
      }
      return { success: false, reason: 'TASK_NOT_FOUND' };
    }
    task.status = 'CANCELLED';
    task.cancelledAt = Date.now();
    task.cancellationReason = reason;
    this.tasks.delete(taskId);
    this.completedTasks.set(taskId, task);
    this.stats.cancelled = (this.stats.cancelled || 0) + 1;
    return { success: true, taskId, status: 'CANCELLED', reason };
  }

  /**
   * Export internal state for crash recovery persistence.
   */
  exportState() {
    return {
      tasks: Array.from(this.tasks.entries()),
      idempotencyIndex: Array.from(this.idempotencyIndex.entries()),
      dlq: Array.from(this.dlq.entries()),
      completedTasks: Array.from(this.completedTasks.entries()),
      stats: { ...this.stats }
    };
  }

  /**
   * Import recovered state from WAL or snapshot.
   */
  importState(state = {}) {
    if (!state) return this;
    if (Array.isArray(state.tasks)) this.tasks = new Map(state.tasks);
    if (Array.isArray(state.idempotencyIndex)) this.idempotencyIndex = new Map(state.idempotencyIndex);
    if (Array.isArray(state.dlq)) this.dlq = new Map(state.dlq);
    if (Array.isArray(state.completedTasks)) this.completedTasks = new Map(state.completedTasks);
    if (state.stats) this.stats = { ...this.stats, ...state.stats };
    return this;
  }

  /**
   * Retrieve task details.
   */
  getTask(taskId) {
    return this.tasks.get(taskId) || this.completedTasks.get(taskId) || this.dlq.get(taskId) || null;
  }

  /**
   * Get DLQ statistics and entries.
   */
  getDlqStats() {
    return {
      size: this.dlq.size,
      items: Array.from(this.dlq.values())
    };
  }
}
