import test from "node:test";
import assert from "node:assert/strict";
import { AdaptivePersonalityEngine } from "../intelligence/hei/adaptive-personality-engine.js";
import { DeepEmotionalAnalyzer } from "../intelligence/hei/emotion-analyzer.js";

test("AdaptivePersonalityEngine: produces correct response policies for representative emotions", () => {
  const engine = new AdaptivePersonalityEngine();

  // 1. Anger Policy
  const angerPolicy = engine.getPolicyForEmotion("ANGER");
  assert.equal(angerPolicy.tone, "COMPOSED, RESPECTFUL, CALM");
  assert.ok(angerPolicy.dos.some(d => d.includes("root cause")));
  assert.ok(angerPolicy.donts.some(d => d.includes("calm down")));

  // 2. Frustration Policy
  const frustPolicy = engine.getPolicyForEmotion("FRUSTRATION");
  assert.equal(frustPolicy.tone, "DIRECT, PRACTICAL, SOLUTION-FOCUSED");
  assert.ok(frustPolicy.dos.some(d => d.includes("next action")));
  assert.ok(frustPolicy.donts.some(d => d.includes("repeat failed instructions")));

  // 3. Sadness Policy
  const sadPolicy = engine.getPolicyForEmotion("SADNESS");
  assert.equal(sadPolicy.tone, "GENTLE, WARM, PATIENT");
  assert.ok(sadPolicy.dos.some(d => d.includes("listen attentively")));
  assert.ok(sadPolicy.donts.some(d => d.includes("just be happy")));

  // 4. Anxiety Policy
  const anxPolicy = engine.getPolicyForEmotion("ANXIETY");
  assert.equal(anxPolicy.tone, "REASSURING, STRUCTURED, GROUNDED");
  assert.ok(anxPolicy.dos.some(d => d.includes("first steps")));
  assert.ok(anxPolicy.donts.some(d => d.includes("false guarantees")));

  // 5. Overwhelmed Policy
  const overPolicy = engine.getPolicyForEmotion("OVERWHELMED");
  assert.equal(overPolicy.tone, "CALM, MINIMALIST, ACTIONABLE");
  assert.ok(overPolicy.dos.some(d => d.includes("isolate one single small next step")));
  assert.ok(overPolicy.donts.some(d => d.includes("giant 20-step master plans")));
});

test("AdaptivePersonalityEngine: dynamically modulates vocal parameters (Kokoro am_onyx speed & mode)", () => {
  const engine = new AdaptivePersonalityEngine();

  // High-energy excitement -> slightly faster delivery
  const excVocal = engine.getVocalParameters({ primaryEmotion: "EXCITEMENT", intensity: 0.85, arousal: 0.9 });
  assert.ok(excVocal.speed >= 1.0);
  assert.equal(excVocal.personalityMode, "SUCCESS");

  // Deep sorrow / grief -> slower, soothing delivery
  const griefVocal = engine.getVocalParameters({ primaryEmotion: "GRIEF", intensity: 0.9, arousal: 0.3 });
  assert.ok(griefVocal.speed <= 0.88);
  assert.equal(griefVocal.personalityMode, "COMFORT");

  // Routine calm -> baseline 0.95 speed
  const calmVocal = engine.getVocalParameters({ primaryEmotion: "CALMNESS", intensity: 0.3, arousal: 0.2 });
  assert.equal(calmVocal.speed, 0.95);
  assert.equal(calmVocal.personalityMode, "NORMAL");
});

test("AdaptivePersonalityEngine: generates comprehensive LLM system directive with user preferences", () => {
  const engine = new AdaptivePersonalityEngine();
  const analyzer = new DeepEmotionalAnalyzer();

  const assessment = analyzer.analyze("I'm trying again and again, but nothing works. Seriously tired of this.");
  const directive = engine.generateSystemDirective(assessment, {
    directAnswersWhenFrustrated: true,
    preferredStyle: "DIRECT"
  });

  assert.ok(directive.includes("USER EMOTIONAL STATE: Frustration"));
  assert.ok(directive.includes("ADAPTIVE TONE: DIRECT, PRACTICAL, SOLUTION-FOCUSED"));
  assert.ok(directive.includes("USER PREFERENCE ACTIVE: User prefers strictly direct answers"));
  assert.ok(directive.includes("Never tell the user how they feel"));
});

test("AdaptivePersonalityEngine: generates natural representative responses matching Directive Section 8", () => {
  const engine = new AdaptivePersonalityEngine();
  const analyzer = new DeepEmotionalAnalyzer();

  // Scenario A — Anger
  const angerAssessment = analyzer.analyze("I'm so angry. This keeps breaking.");
  const angerResp = engine.generateAdaptiveResponse("I'm so angry. This keeps breaking.", angerAssessment);
  assert.ok(angerResp.includes("root cause") || angerResp.includes("infuriating"));

  // Scenario B — Sadness
  const sadAssessment = analyzer.analyze("I don't feel good today.");
  const sadResp = engine.generateAdaptiveResponse("I don't feel good today.", sadAssessment);
  assert.ok(sadResp.includes("listen") || sadResp.includes("heavy"));

  // Scenario C — Excitement
  const excAssessment = analyzer.analyze("ULTRON! It finally works!");
  const excResp = engine.generateAdaptiveResponse("ULTRON! It finally works!", excAssessment);
  assert.ok(excResp.includes("fantastic") || excResp.includes("momentum"));

  // Scenario D — Anxiety
  const anxAssessment = analyzer.analyze("I'm nervous about what happens next.");
  const anxResp = engine.generateAdaptiveResponse("I'm nervous about what happens next.", anxAssessment);
  assert.ok(anxResp.includes("uncertainty") || anxResp.includes("together"));
});
