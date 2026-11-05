import test from 'node:test';
import assert from 'node:assert/strict';
import { ByoxTaskLeaseWorker } from '../core/byox-task-lease-worker.js';

test('ByoxTaskLeaseWorker: enqueue, deduplicate, and acquire lease', () => {
  const queue = new ByoxTaskLeaseWorker({ leaseDurationMs: 1000 });

  const res1 = queue.enqueueTask({ action: 'process_image' }, { idempotencyKey: 'key_123', priority: 5 });
  assert.equal(res1.status, 'ENQUEUED');

  // Duplicate enqueue returns existing
  const res2 = queue.enqueueTask({ action: 'process_image' }, { idempotencyKey: 'key_123' });
  assert.equal(res2.status, 'DEDUPLICATED');
  assert.equal(res2.taskId, res1.taskId);

  // Worker acquires lease
  const lease = queue.acquireLease('worker_alpha');
  assert.ok(lease);
  assert.equal(lease.id, res1.taskId);
  assert.equal(lease.status, 'RUNNING');
  assert.equal(lease.leaseWorkerId, 'worker_alpha');
});

test('ByoxTaskLeaseWorker: heartbeat renewal and completion', () => {
  const queue = new ByoxTaskLeaseWorker({ leaseDurationMs: 500 });
  const { taskId } = queue.enqueueTask({ action: 'run_tests' });

  queue.acquireLease('worker_beta');
  const renew = queue.renewLease(taskId, 'worker_beta');
  assert.equal(renew.success, true);
  assert.ok(renew.leaseExpiresAt > Date.now());

  const comp = queue.completeTask(taskId, 'worker_beta', { exitCode: 0 });
  assert.equal(comp.success, true);
  assert.equal(queue.getTask(taskId).status, 'COMPLETED');
});

test('ByoxTaskLeaseWorker: retry handling, dead-letter queue, and redrive', () => {
  const queue = new ByoxTaskLeaseWorker({ maxRetries: 2 });
  const { taskId } = queue.enqueueTask({ action: 'flaky_network_call' });

  // 1st failure -> RETRY_SCHEDULED
  queue.acquireLease('worker_gamma');
  const f1 = queue.failTask(taskId, 'worker_gamma', new Error('ECONNRESET'));
  assert.equal(f1.status, 'RETRY_SCHEDULED');

  // 2nd failure -> MOVED_TO_DLQ
  queue.acquireLease('worker_gamma');
  const f2 = queue.failTask(taskId, 'worker_gamma', new Error('ETIMEDOUT'));
  assert.equal(f2.status, 'MOVED_TO_DLQ');

  const dlqStats = queue.getDlqStats();
  assert.equal(dlqStats.size, 1);
  assert.equal(dlqStats.items[0].id, taskId);

  // Redrive
  const redrive = queue.redriveDeadLetter(taskId);
  assert.equal(redrive.success, true);
  assert.equal(queue.getDlqStats().size, 0);
  assert.equal(queue.getTask(taskId).status, 'PENDING');
});
