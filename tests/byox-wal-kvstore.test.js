import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { ByoxWalKvStore } from '../memory/byox-wal-kvstore.js';

const testDir = path.join(process.cwd(), '.tmp-byox-wal-test');

test('ByoxWalKvStore: basic set, get, delete, and persistence across recovery', () => {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }

  const store1 = new ByoxWalKvStore({ storageDir: testDir });
  store1.set('user_1', { name: 'Ayaan', role: 'admin' });
  store1.set('user_2', { name: 'Assistant', role: 'ai' });

  assert.equal(store1.get('user_1').name, 'Ayaan');
  assert.equal(store1.size, 2);

  store1.delete('user_2');
  assert.equal(store1.has('user_2'), false);
  assert.equal(store1.size, 1);

  // Instantiate new store on same dir to test replay
  const store2 = new ByoxWalKvStore({ storageDir: testDir });
  assert.equal(store2.get('user_1').name, 'Ayaan');
  assert.equal(store2.has('user_2'), false);
  assert.equal(store2.size, 1);

  fs.rmSync(testDir, { recursive: true, force: true });
});

test('ByoxWalKvStore: transactions commit and rollback', () => {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }

  const store = new ByoxWalKvStore({ storageDir: testDir });
  store.set('key_base', 'val_base');

  // Rollback
  store.beginTransaction();
  store.set('key_rolled', 'should_not_exist');
  store.rollback();

  assert.equal(store.has('key_rolled'), false);

  // Commit
  store.beginTransaction();
  store.set('key_committed', 'persisted_val');
  store.commit();

  assert.equal(store.get('key_committed'), 'persisted_val');

  fs.rmSync(testDir, { recursive: true, force: true });
});

test('ByoxWalKvStore: atomic compaction snapshot and corruption repair', () => {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }

  const store = new ByoxWalKvStore({ storageDir: testDir });
  for (let i = 0; i < 10; i++) {
    store.set(`item_${i}`, i * 10);
  }

  assert.equal(store.size, 10);
  store.compactSnapshot();

  // Snapshot file should exist
  assert.ok(fs.existsSync(path.join(testDir, 'store.snapshot.json')));

  // Corrupt WAL by appending broken JSON line
  fs.appendFileSync(path.join(testDir, 'store.wal'), '{"op":"BROKEN","corrupted":true\n', 'utf8');

  // Recovering store should gracefully heal corrupted line
  const storeRecovered = new ByoxWalKvStore({ storageDir: testDir });
  assert.equal(storeRecovered.size, 10);
  assert.equal(storeRecovered.get('item_5'), 50);
  assert.ok(storeRecovered.stats.corruptionsRepaired >= 1);

  fs.rmSync(testDir, { recursive: true, force: true });
});
