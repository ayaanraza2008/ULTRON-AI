import test from 'node:test';
import assert from 'node:assert/strict';
import { ByoxRagSearch } from '../memory/byox-rag-search.js';

test('ByoxRagSearch: chunking text with sliding window', () => {
  const rag = new ByoxRagSearch({ chunkSize: 10, chunkOverlap: 2 });
  const sampleWords = Array.from({ length: 25 }, (_, i) => `word${i}`).join(' ');

  const chunks = rag.chunkText(sampleWords, { source: 'doc1' });
  assert.ok(chunks.length >= 3);
  assert.equal(chunks[0].chunkIndex, 0);
  assert.equal(chunks[0].metadata.source, 'doc1');
});

test('ByoxRagSearch: document indexing and BM25 + Dense hybrid retrieval', () => {
  const rag = new ByoxRagSearch();

  rag.indexDocument('doc_quantum', 'Quantum computing uses qubits and superposition to solve complex problems.', { category: 'physics' });
  rag.indexDocument('doc_browser', 'The Chromium browser automation driver interacts with tabs and clicks buttons.', { category: 'automation' });
  rag.indexDocument('doc_security', 'Firewalls, cryptographic HMAC signatures, and encryption protect network APIs.', { category: 'cybersecurity' });

  assert.equal(rag.documents.size, 3);

  // Search for browser automation
  const results = rag.search('automate chromium browser and click buttons', { topK: 2 });
  assert.ok(results.length > 0);
  assert.equal(results[0].id, 'doc_browser');
  assert.ok(results[0].score > 0);
  assert.equal(results[0].metadata.category, 'automation');
});

test('ByoxRagSearch: document removal updates index and statistics', () => {
  const rag = new ByoxRagSearch();
  rag.indexDocument('doc_a', 'first sample document');
  rag.indexDocument('doc_b', 'second sample document');

  assert.equal(rag.documents.size, 2);
  const removed = rag.removeDocument('doc_a');
  assert.equal(removed, true);
  assert.equal(rag.documents.size, 1);
  assert.equal(rag.documents.has('doc_a'), false);

  const results = rag.search('first sample');
  const foundA = results.some(r => r.id === 'doc_a');
  assert.equal(foundA, false);
});
