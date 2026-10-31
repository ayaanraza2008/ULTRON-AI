import test from "node:test";
import assert from "node:assert/strict";
import { EMOTIONS, getAllEmotionKeys, getEmotionMetadata, EMOTION_LETTERS } from "../intelligence/hei/emotion-taxonomy.js";

test("EmotionTaxonomy: registers all 51 emotions spanning letters A through Z", () => {
  const keys = getAllEmotionKeys();
  assert.equal(keys.length, 51, "Must contain all 51 defined emotions");

  // Check each letter category
  const lettersInTaxonomy = new Set(Object.values(EMOTIONS).map(e => e.letter));
  EMOTION_LETTERS.forEach(l => {
    assert.ok(lettersInTaxonomy.has(l), `Taxonomy must have emotions for letter ${l}`);
  });
});

test("EmotionTaxonomy: verifies all specific emotions required by user directive", () => {
  const required = [
    // A
    'ADMIRATION', 'ADORATION', 'ANGER', 'ANXIETY', 'APATHY', 'AWE', 'AWKWARDNESS',
    // B
    'BOREDOM', 'BITTERNESS',
    // C
    'CALMNESS', 'COMPASSION', 'CONTEMPT', 'CRAVING',
    // D
    'DISGUST', 'DISAPPOINTMENT',
    // E
    'EMBARRASSMENT', 'ENVY', 'EXCITEMENT',
    // F
    'FEAR', 'FRUSTRATION',
    // G
    'GRATITUDE', 'GRIEF', 'GUILT',
    // H
    'HAPPINESS', 'HOPE', 'HORROR',
    // I
    'INTEREST', 'ISOLATION',
    // J
    'JOY', 'JEALOUSY',
    // K
    'KINDNESS',
    // L
    'LONELINESS', 'LOVE',
    // M
    'MELANCHOLY',
    // N
    'NOSTALGIA',
    // O
    'OVERWHELMED',
    // P
    'PRIDE', 'PITY',
    // R
    'REGRET', 'RELIEF', 'RESENTMENT',
    // S
    'SADNESS', 'SATISFACTION', 'SCHADENFREUDE', 'SURPRISE',
    // T
    'TRIUMPH',
    // U
    'UNEASE',
    // V
    'VULNERABILITY',
    // W
    'WONDER',
    // Y
    'YEARNING',
    // Z
    'ZEAL'
  ];

  required.forEach(key => {
    const meta = EMOTIONS[key];
    assert.ok(meta, `Emotion ${key} must exist in taxonomy`);
    assert.equal(meta.key, key);
    assert.ok(meta.name && meta.name.length > 0);
    assert.ok(meta.description && meta.description.length > 0);
    assert.ok(Array.isArray(meta.triggers) && meta.triggers.length > 0);
    assert.ok(typeof meta.valence === 'number' && meta.valence >= -1.0 && meta.valence <= 1.0);
    assert.ok(typeof meta.arousal === 'number' && meta.arousal >= 0.0 && meta.arousal <= 1.0);
    assert.ok(Array.isArray(meta.indicators) && meta.indicators.length > 0);
    assert.ok(meta.responsePolicy && meta.responsePolicy.strategy);
    assert.ok(Array.isArray(meta.responsePolicy.dos) && meta.responsePolicy.dos.length > 0);
    assert.ok(Array.isArray(meta.responsePolicy.donts) && meta.responsePolicy.donts.length > 0);
    assert.ok(meta.vocalSettings && meta.vocalSettings.speed);
    assert.ok(meta.coreVisualState);
  });
});

test("EmotionTaxonomy: getEmotionMetadata looks up by key or name case-insensitively", () => {
  const metaKey = getEmotionMetadata("anger");
  assert.equal(metaKey.key, "ANGER");

  const metaName = getEmotionMetadata("Schadenfreude");
  assert.equal(metaName.key, "SCHADENFREUDE");

  const metaNull = getEmotionMetadata("non_existent_feeling");
  assert.equal(metaNull, null);
});
