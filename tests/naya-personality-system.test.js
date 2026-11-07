import test from "node:test";
import assert from "node:assert/strict";
import {
  nayaPersonalitySystem,
  NayaPersonalitySystem,
  NAYA_PERSONALITY_MODES,
  NAYA_MODE_METADATA
} from "../intelligence/naya/naya-personality-system.js";

test("NAYA Personality System: All 20 ERA modes are uniquely registered with complete metadata", () => {
  const modes = Object.values(NAYA_PERSONALITY_MODES);
  assert.equal(modes.length, 20, "Must have exactly 20 personality modes");

  const expectedModes = [
    "PROFESSIONAL_JARVIS",
    "BEST_FRIEND",
    "STRICT_MENTOR",
    "TECHNICAL_EXPERT",
    "RESEARCH_ASSISTANT",
    "CODING_PARTNER",
    "PRODUCTIVITY_ASSISTANT",
    "PERSONAL_COMPANION",
    "TEACHER",
    "CREATIVE_THINKER",
    "BUSINESS_ASSISTANT",
    "SYSTEM_OPERATOR",
    "CRITICAL_ANALYST",
    "PROBLEM_SOLVER",
    "INTERVIEW_COACH",
    "STUDY_PARTNER",
    "STRATEGIC_ADVISOR",
    "MINIMAL_RESPONSE",
    "DETAILED_EXPLANATION",
    "AUTONOMOUS_AGENT"
  ];

  for (const expected of expectedModes) {
    assert.ok(NAYA_PERSONALITY_MODES[expected], `Mode ${expected} must be in NAYA_PERSONALITY_MODES`);
    const meta = NAYA_MODE_METADATA[expected];
    assert.ok(meta, `Metadata for ${expected} must exist`);
    assert.ok(meta.name, `Name for ${expected} must exist`);
    assert.ok(meta.tagline, `Tagline for ${expected} must exist`);
    assert.equal(typeof meta.voiceSpeed, "number", `Voice speed for ${expected} must be a number`);
    assert.equal(meta.kokoroVoice, "af_bella", `All NAYA modes must use female Kokoro voice af_bella`);
    assert.ok(Array.isArray(meta.intentTriggers), `Intent triggers for ${expected} must be an array`);
  }
});

test("NAYA Personality System: Runtime mode switching and invalid mode rejection", () => {
  const system = new NayaPersonalitySystem();
  assert.equal(system.getMode(), NAYA_PERSONALITY_MODES.PROFESSIONAL_JARVIS);

  const res1 = system.setMode("BEST_FRIEND");
  assert.equal(res1.success, true);
  assert.equal(system.getMode(), NAYA_PERSONALITY_MODES.BEST_FRIEND);

  const res2 = system.setMode("coding-partner");
  assert.equal(res2.success, true);
  assert.equal(system.getMode(), NAYA_PERSONALITY_MODES.CODING_PARTNER);

  const resInvalid = system.setMode("NON_EXISTENT_MODE");
  assert.equal(resInvalid.success, false);
  assert.equal(resInvalid.error, "INVALID_MODE");
  assert.equal(system.getMode(), NAYA_PERSONALITY_MODES.CODING_PARTNER, "Mode must remain unchanged on invalid input");
});

test("NAYA Personality System: Context-aware intent auto-detection", () => {
  const system = new NayaPersonalitySystem();

  assert.equal(system.detectBestMode("I have a bug in my javascript function"), NAYA_PERSONALITY_MODES.CODING_PARTNER);
  assert.equal(system.detectBestMode("I am procrastinating and lazy today"), NAYA_PERSONALITY_MODES.STRICT_MENTOR);
  assert.equal(system.detectBestMode("I am feeling sad and stressed"), NAYA_PERSONALITY_MODES.PERSONAL_COMPANION);
  assert.equal(system.detectBestMode("Teach me how quantum computing works from first principles"), NAYA_PERSONALITY_MODES.TEACHER);
  assert.equal(system.detectBestMode("Check cpu vitals and hardware telemetry"), NAYA_PERSONALITY_MODES.SYSTEM_OPERATOR);
  assert.equal(system.detectBestMode("Keep it brief and short"), NAYA_PERSONALITY_MODES.MINIMAL_RESPONSE);
  assert.equal(system.detectBestMode("Let us automate this workflow pipeline"), NAYA_PERSONALITY_MODES.AUTONOMOUS_AGENT);
});

test("NAYA Personality System: Prompt generation embeds ERA protocols (Language, Length, Silence)", () => {
  const system = new NayaPersonalitySystem();
  const prompt = system.generateSystemPrompt({ mode: NAYA_PERSONALITY_MODES.STRICT_MENTOR });

  assert.ok(prompt.includes("NAYA — AUTONOMOUS INTELLIGENCE CORE"));
  assert.ok(prompt.includes("CURRENT PERSONALITY MODE: STRICT MENTOR"));
  assert.ok(prompt.includes("STRICT DYNAMIC LANGUAGE PROTOCOL"));
  assert.ok(prompt.includes("Hindi in Devanagari script"));
  assert.ok(prompt.toLowerCase().includes("natural hinglish"));
  assert.ok(prompt.includes("STRICT RESPONSE LENGTH PROTOCOL"));
  assert.ok(prompt.includes("ABSOLUTE SILENCE & VERBAL CONFIRMATION PROTOCOL"));
  assert.ok(prompt.includes("Zero patience for excuses"));
});

test("NAYA Personality System: Custom instructions overlay cleanly", () => {
  const system = new NayaPersonalitySystem();
  const custom = "Always mention project milestone deadlines in IST.";
  const prompt = system.generateSystemPrompt({
    mode: NAYA_PERSONALITY_MODES.PROFESSIONAL_JARVIS,
    customInstructions: custom
  });

  assert.ok(prompt.includes("USER CUSTOM DIRECTIVES"));
  assert.ok(prompt.includes(custom));
});
