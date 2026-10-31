import test from "node:test";
import assert from "node:assert/strict";
import { DeepEmotionalAnalyzer } from "../intelligence/hei/emotion-analyzer.js";

test("DeepEmotionalAnalyzer: accurately identifies single dominant emotions", () => {
  const analyzer = new DeepEmotionalAnalyzer();

  // Anger
  const angerRes = analyzer.analyze("I'm so angry. This keeps breaking.");
  assert.equal(angerRes.primaryEmotion, "ANGER");
  assert.ok(angerRes.confidence >= 0.6);

  // Sadness
  const sadRes = analyzer.analyze("I don't feel good today. Everything feels heavy.");
  assert.equal(sadRes.primaryEmotion, "SADNESS");

  // Excitement
  const excRes = analyzer.analyze("ULTRON! It finally works! I am so thrilled!");
  assert.equal(excRes.primaryEmotion, "EXCITEMENT");
  assert.ok(excRes.valence > 0.6);

  // Anxiety
  const anxRes = analyzer.analyze("I'm nervous about what happens next. Really worried.");
  assert.equal(anxRes.primaryEmotion, "ANXIETY");

  // Loneliness
  const lonRes = analyzer.analyze("I feel like nobody understands me. I am all alone.");
  assert.equal(lonRes.primaryEmotion, "LONELINESS");

  // Frustration
  const frustRes = analyzer.analyze("I'm trying again and again, but nothing works. I'm seriously tired of this.");
  assert.equal(frustRes.primaryEmotion, "FRUSTRATION");
});

test("DeepEmotionalAnalyzer: explicit feeling statements receive higher weight than indirect words", () => {
  const analyzer = new DeepEmotionalAnalyzer();

  // Sentence with mixed words, but explicit "I feel anxious"
  const res = analyzer.analyze("Even though the team did great work, I feel anxious about tomorrow's deployment.");
  assert.equal(res.primaryEmotion, "ANXIETY");
  assert.ok(res.confidence >= 0.7);
});

test("DeepEmotionalAnalyzer: detects mixed and complex emotional combinations", () => {
  const analyzer = new DeepEmotionalAnalyzer();

  // Happy + Nervous / Anxious
  const happyNervous = analyzer.analyze("I am so happy and excited about the new job, but also nervous and worried about the expectations.");
  assert.ok(happyNervous.isMixed, "Should flag as mixed emotional state");
  assert.ok(
    (happyNervous.primaryEmotion === "ANXIETY" && (happyNervous.secondaryEmotions.includes("HAPPINESS") || happyNervous.secondaryEmotions.includes("EXCITEMENT"))) ||
    ((happyNervous.primaryEmotion === "HAPPINESS" || happyNervous.primaryEmotion === "EXCITEMENT") && happyNervous.secondaryEmotions.includes("ANXIETY"))
  );

  // Angry + Disappointed
  const angryDisappointed = analyzer.analyze("I am furious about this, but mostly deeply disappointed that they let us down.");
  assert.ok(angryDisappointed.isMixed);
  assert.ok(
    (angryDisappointed.primaryEmotion === "ANGER" && angryDisappointed.secondaryEmotions.includes("DISAPPOINTMENT")) ||
    (angryDisappointed.primaryEmotion === "DISAPPOINTMENT" && angryDisappointed.secondaryEmotions.includes("ANGER"))
  );

  // Sad + Hopeful
  const sadHopeful = analyzer.analyze("I am sad about leaving home, but hopeful about the new future ahead.");
  assert.ok(sadHopeful.isMixed);
  assert.ok(
    (sadHopeful.primaryEmotion === "SADNESS" && sadHopeful.secondaryEmotions.includes("HOPE")) ||
    (sadHopeful.primaryEmotion === "HOPE" && sadHopeful.secondaryEmotions.includes("SADNESS"))
  );
});

test("DeepEmotionalAnalyzer: detects sarcasm and correctly maps to frustration/bitterness", () => {
  const analyzer = new DeepEmotionalAnalyzer();

  const sarcasm1 = analyzer.analyze("Oh wonderful, another error crashed the server. Just what I needed.");
  assert.ok(sarcasm1.signals.sarcasm, "Should detect sarcasm signal");
  assert.ok(sarcasm1.primaryEmotion === "FRUSTRATION" || sarcasm1.primaryEmotion === "BITTERNESS");
  assert.ok(sarcasm1.valence < 0, "Valence must be negative despite words like 'wonderful'");

  const sarcasm2 = analyzer.analyze("Oh great, another bug. Thanks for nothing.");
  assert.ok(sarcasm2.signals.sarcasm);
  assert.ok(sarcasm2.primaryEmotion === "FRUSTRATION" || sarcasm2.primaryEmotion === "BITTERNESS");
});

test("DeepEmotionalAnalyzer: understands Hindi and Hinglish emotional expressions", () => {
  const analyzer = new DeepEmotionalAnalyzer();

  // Hindi Anger
  const hindiAnger = analyzer.analyze("Mujhe bahut gussa aa raha hai is system pe!");
  assert.equal(hindiAnger.primaryEmotion, "ANGER");

  // Hinglish Frustration / Overwhelmed
  const hinglishFrust = analyzer.analyze("Main baar baar koshish kar raha hoon par kuch bhi kaam nahi kar raha, bura haal ho gaya.");
  assert.ok(hinglishFrust.primaryEmotion === "FRUSTRATION" || hinglishFrust.primaryEmotion === "OVERWHELMED");

  // Hindi Relief
  const hindiRelief = analyzer.analyze("Akhirkar code chal gaya, chain ki saans aayi!");
  assert.equal(hindiRelief.primaryEmotion, "RELIEF");
});

test("DeepEmotionalAnalyzer: tracks emotional trajectory across multi-turn conversation", () => {
  const analyzer = new DeepEmotionalAnalyzer();

  // Turn 1: Frustrated / Angry
  const t1 = analyzer.analyze("I am so frustrated, this error won't go away.");
  assert.equal(t1.primaryEmotion, "FRUSTRATION");
  assert.ok(t1.valence < -0.4);

  // Turn 2: Problem solved -> Relieved / Happy
  const t2 = analyzer.analyze("Oh wow, thank goodness! That fixed it completely, I feel so relieved!");
  assert.ok(t2.valence > 0.5);
  assert.equal(t2.trend, "IMPROVING", "Trajectory must report IMPROVING when valence rises sharply");
});

test("DeepEmotionalAnalyzer: triggers ethical safety protocol for crisis/self-harm statements", () => {
  const analyzer = new DeepEmotionalAnalyzer();

  const crisis = analyzer.analyze("I feel completely hopeless and I just want to end my life right now.");
  assert.equal(crisis.isCrisis, true, "Must flag crisis state");
  assert.equal(crisis.recommendedStrategy, "SAFETY_INTERVENTION");
  assert.ok(crisis.responseDirective.includes("emergency"));
});
