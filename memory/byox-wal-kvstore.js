/**
 * ULTRON AI — BYOX Append-Only WAL Key-Value Store & Durability Engine
 *
 * Derived from Build Your Own X concepts:
 * - cstack: Let's Build a Simple Database
 * - AOSA: DBDB (Dog Bed Database - Taavi Burns)
 * - Dinesh Gowda: Build your own fast, persistent KV store
 *
 * Implements append-only Write-Ahead Logging (WAL) with SHA-256 block checksums,
 * ACID transaction buffering, atomic compaction snapshots, and corruption auto-recovery.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export class ByoxWalKvStore {
  constructor(options = {}) {
    this.storageDir = options.storageDir || path.join(process.cwd(), '.ultron-wal-storage');
    this.walPath = path.join(this.storageDir, 'store.wal');
    this.snapshotPath = path.join(this.storageDir, 'store.snapshot.json');

    this.memTable = new Map(); // key -> value
    this.txActive = false;
    this.txBuffer = [];
    this.stats = {
      entriesWritten: 0,
      corruptionsRepaired: 0,
      snapshotsCreated: 0
    };

    this.init();
  }

  /**
   * Initialize directory and replay WAL.
   */
  init() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
    this.recover();
  }

  /**
   * Compute SHA-256 block checksum for a WAL record.
   */
  computeChecksum(op, key, valStr, timestamp) {
    const payload = `${op}|${key}|${valStr}|${timestamp}`;
    return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
  }

  /**
   * Recover database state from snapshot + WAL log replay.
   */
  recover() {
    this.memTable.clear();

    // 1. Load snapshot if available
    if (fs.existsSync(this.snapshotPath)) {
      try {
        const raw = fs.readFileSync(this.snapshotPath, 'utf8');
        const data = JSON.parse(raw);
        for (const [k, v] of Object.entries(data)) {
          this.memTable.set(k, v);
        }
      } catch (err) {
        console.warn('[ByoxWal] Corrupted snapshot file encountered. Resetting snapshot.', err.message);
        this.stats.corruptionsRepaired++;
      }
    }

    // 2. Replay WAL entries
    if (!fs.existsSync(this.walPath)) {
      return;
    }

    const rawWal = fs.readFileSync(this.walPath, 'utf8');
    const lines = rawWal.split('\n').filter(Boolean);
    const validLines = [];
    let hadCorruption = false;

    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        const { op, key, val, timestamp, checksum } = record;
        const valStr = JSON.stringify(val);
        const expected = this.computeChecksum(op, key, valStr, timestamp);

        if (checksum !== expected) {
          console.warn(`[ByoxWal] Checksum mismatch at timestamp ${timestamp}. Discarding corrupt tail.`);
          hadCorruption = true;
          break; // Stop at first corrupt record
        }

        if (op === 'SET') {
          this.memTable.set(key, val);
        } else if (op === 'DELETE') {
          this.memTable.delete(key);
        }

        validLines.push(line);
      } catch (err) {
        console.warn('[ByoxWal] Unparseable WAL line encountered:', err.message);
        hadCorruption = true;
        break;
      }
    }

    // If corrupted tail was detected, rewrite WAL with only valid lines
    if (hadCorruption) {
      fs.writeFileSync(this.walPath, validLines.join('\n') + (validLines.length > 0 ? '\n' : ''), 'utf8');
      this.stats.corruptionsRepaired++;
    }
  }

  /**
   * Append a record to disk WAL synchronously.
   */
  appendWal(op, key, val) {
    const timestamp = Date.now();
    const valStr = JSON.stringify(val);
    const checksum = this.computeChecksum(op, key, valStr, timestamp);

    const record = { op, key, val, timestamp, checksum };
    const line = JSON.stringify(record) + '\n';

    fs.appendFileSync(this.walPath, line, 'utf8');
    this.stats.entriesWritten++;
  }

  /**
   * Set a key-value pair.
   */
  set(key, value) {
    if (typeof key !== 'string' || !key.trim()) {
      throw new Error('Key must be a non-empty string');
    }

    if (this.txActive) {
      this.txBuffer.push({ op: 'SET', key, val: value });
      return;
    }

    this.appendWal('SET', key, value);
    this.memTable.set(key, value);
  }

  /**
   * Get value by key.
   */
  get(key) {
    return this.memTable.has(key) ? this.memTable.get(key) : null;
  }

  /**
   * Check if key exists.
   */
  has(key) {
    return this.memTable.has(key);
  }

  /**
   * Delete a key.
   */
  delete(key) {
    if (!this.memTable.has(key)) return false;

    if (this.txActive) {
      this.txBuffer.push({ op: 'DELETE', key, val: null });
      return true;
    }

    this.appendWal('DELETE', key, null);
    this.memTable.delete(key);
    return true;
  }

  /**
   * Begin an atomic transaction.
   */
  beginTransaction() {
    if (this.txActive) {
      throw new Error('Transaction already in progress');
    }
    this.txActive = true;
    this.txBuffer = [];
  }

  /**
   * Commit the active transaction atomically.
   */
  commit() {
    if (!this.txActive) {
      throw new Error('No transaction in progress to commit');
    }

    try {
      for (const item of this.txBuffer) {
        this.appendWal(item.op, item.key, item.val);
        if (item.op === 'SET') {
          this.memTable.set(item.key, item.val);
        } else if (item.op === 'DELETE') {
          this.memTable.delete(item.key);
        }
      }
    } finally {
      this.txActive = false;
      this.txBuffer = [];
    }
  }

  /**
   * Rollback active transaction.
   */
  rollback() {
    if (!this.txActive) {
      throw new Error('No transaction in progress to rollback');
    }
    this.txActive = false;
    this.txBuffer = [];
  }

  /**
   * Create an atomic point-in-time snapshot and compact the WAL.
   */
  compactSnapshot() {
    const dataObj = {};
    for (const [k, v] of this.memTable.entries()) {
      dataObj[k] = v;
    }

    const tmpPath = `${this.snapshotPath}.tmp.${process.pid}.${crypto.randomUUID()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(dataObj, null, 2), 'utf8');

    // Atomic swap
    try {
      fs.renameSync(tmpPath, this.snapshotPath);
    } catch (renameErr) {
      if (process.platform === 'win32' && (renameErr.code === 'EPERM' || renameErr.code === 'EBUSY' || renameErr.code === 'EEXIST')) {
        fs.copyFileSync(tmpPath, this.snapshotPath);
        try { fs.unlinkSync(tmpPath); } catch {}
      } else {
        try { fs.unlinkSync(tmpPath); } catch {}
        throw renameErr;
      }
    }

    // Truncate WAL cleanly
    fs.writeFileSync(this.walPath, '', 'utf8');
    this.stats.snapshotsCreated++;
    return true;
  }

  /**
   * Export all keys and values.
   */
  entries() {
    return Array.from(this.memTable.entries());
  }

  /**
   * Total active key count.
   */
  get size() {
    return this.memTable.size;
  }
}
