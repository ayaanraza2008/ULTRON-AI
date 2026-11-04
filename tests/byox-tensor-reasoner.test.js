import test from 'node:test';
import assert from 'node:assert/strict';
import { ByoxTensorReasoner } from '../core/byox-tensor-reasoner.js';

test('ByoxTensorReasoner: vector math and normalization', () => {
  const reasoner = new ByoxTensorReasoner({ dimensions: 4 });
  const a = [1, 2, 3, 4];
  const b = [2, 0, 1, -1];

  const dot = reasoner.dotProduct(a, b);
  assert.equal(dot, (1*2 + 2*0 + 3*1 + 4*-1)); // 2 + 0 + 3 - 4 = 1

  const norm = reasoner.vectorNorm([3, 4, 0, 0]);
  assert.equal(norm, 5);

  const normalized = reasoner.normalizeVector([0, 3, 4, 0]);
  assert.equal(normalized[1], 0.6);
  assert.equal(normalized[2], 0.8);
  assert.ok(Math.abs(reasoner.vectorNorm(normalized) - 1.0) < 1e-6);
});

test('ByoxTensorReasoner: cosine similarity and orthogonal vectors', () => {
  const reasoner = new ByoxTensorReasoner();
  const v1 = [1, 0, 0];
  const v2 = [0, 1, 0];
  const v3 = [1, 0, 0];

  assert.equal(reasoner.cosineSimilarity(v1, v2), 0);
  assert.ok(Math.abs(reasoner.cosineSimilarity(v1, v3) - 1.0) < 1e-6);
});

test('ByoxTensorReasoner: deterministic subword hash embedding and similarity', () => {
  const reasoner = new ByoxTensorReasoner({ dimensions: 128 });
  const text1 = 'open the browser window';
  const text2 = 'open a new browser tab';
  const text3 = 'play some rock music on speakers';

  const emb1 = reasoner.embed(text1);
  const emb2 = reasoner.embed(text2);
  const emb3 = reasoner.embed(text3);

  assert.equal(emb1.length, 128);
  assert.equal(emb2.length, 128);

  const simRelated = reasoner.cosineSimilarity(emb1, emb2);
  const simUnrelated = reasoner.cosineSimilarity(emb1, emb3);

  assert.ok(simRelated > simUnrelated, `Related similarity (${simRelated}) should exceed unrelated (${simUnrelated})`);
});

test('ByoxTensorReasoner: zero-shot intent classification', () => {
  const reasoner = new ByoxTensorReasoner({ dimensions: 128, temperature: 0.05 });
  const candidates = [
    { name: 'BROWSER_AUTOMATION', description: 'navigate to a webpage, click buttons, or search google' },
    { name: 'SYSTEM_VOLUME', description: 'increase volume, mute audio, or adjust speakers' },
    { name: 'SECURITY_AUDIT', description: 'scan for vulnerabilities, check file permissions, or detect malware' }
  ];

  const query = 'turn up the volume please';
  const res = reasoner.classifyIntent(query, candidates);

  assert.equal(res.topIntent, 'SYSTEM_VOLUME');
  assert.ok(res.confidence > 0.5, 'Expected top intent confidence > 0.5');
  assert.ok(res.marginOfConfidence > 0.2, 'Expected strong margin of confidence');
});
