import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntegrationCatalog } from '../integrations/catalog.js';
test('VoiceStudio is represented in the integration catalog', () => {
 const item = buildIntegrationCatalog({ VOICESTUDIO_BASE_URL: 'https://voice.example', VOICESTUDIO_API_KEY: 'test' }).find(x => x.id === 'voicestudio');
 assert.ok(item);
 assert.equal(item.configured, true);
});
