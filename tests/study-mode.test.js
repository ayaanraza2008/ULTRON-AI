import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter, normalizeStudyPackResult } from "../agent-runtime.js";
import { classifyTaskRoute } from "../task-router.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const generatedPack = {
  learningObjectives: ["Define photosynthesis", "Explain the role of chlorophyll"],
  summary: "Photosynthesis converts light energy into chemical energy stored in organic molecules.",
  flashcards: [
    { question: "What is photosynthesis?", answer: "The process by which plants use light to produce sugars from carbon dioxide and water." },
    { question: "What pigment absorbs light?", answer: "Chlorophyll." }
  ],
  quiz: [
    {
      question: "Which gas is taken in during photosynthesis?",
      options: ["Oxygen", "Carbon dioxide", "Nitrogen", "Hydrogen"],
      answerIndex: 1,
      explanation: "Carbon dioxide supplies carbon used to build sugars."
    }
  ],
  revisionChecklist: ["Know the overall role of light", "Remember the inputs and products"],
  sourceNotes: "General knowledge draft; check this against the course syllabus."
};

async function withAgentServer(env, fetchImpl, run, extras = {}) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use("/api", createAgentRouter({
    env: { ...env, ULTRON_INTEGRATION_OWNER_USER_ID: USER_ID },
    fetchImpl,
    supabaseRest: extras.supabaseRest,
    privilegedSupabaseRest: extras.supabaseRest,
    requireSupabaseUser: (req, _res, next) => {
      req.supabaseUser = { id: USER_ID };
      next();
    },
    logger: { warn() {}, info() {} }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    await run("http://127.0.0.1:" + server.address().port);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("study-pack normalization bounds fields and validates multiple-choice answers", () => {
  const normalized = normalizeStudyPackResult({
    ...generatedPack,
    flashcards: [
      ...generatedPack.flashcards,
      { question: "extra card 1", answer: "extra answer 1" },
      { question: "extra card 2", answer: "extra answer 2" }
    ],
    quiz: [
      ...generatedPack.quiz,
      {
        question: "Invalid option index?",
        options: ["A", "B", "C", "D"],
        answerIndex: 4,
        explanation: "This should be rejected."
      }
    ]
  }, { topic: "Photosynthesis", level: "beginner", format: "mixed", language: "English", questionCount: 3 }, {
    generatedAt: "2026-10-29T00:00:00.000Z",
    model: "test-study-model"
  });

  assert.equal(normalized.state, "completed");
  assert.equal(normalized.topic, "Photosynthesis");
  assert.equal(normalized.model, "test-study-model");
  assert.equal(normalized.generatedAt, "2026-10-29T00:00:00.000Z");
  assert.equal(normalized.flashcards.length, 3);
  assert.equal(normalized.quiz.length, 1);
  assert.equal(normalized.quiz[0].answerIndex, 1);
  assert.equal(normalized.sourceMode, "general_knowledge_draft");
  assert.match(normalized.notice, /AI-generated study aid/);
});

test("study-pack normalization preserves source provenance and format-specific sections", () => {
  const result = normalizeStudyPackResult({
    ...generatedPack,
    quiz: [],
    flashcards: []
  }, {
    topic: "Chapter notes",
    level: "exam",
    format: "revision_sheet",
    language: "English",
    sourceContent: "The supplied course notes say photosynthesis uses light energy."
  });

  assert.equal(result.format, "revision_sheet");
  assert.deepEqual(result.quiz, []);
  assert.deepEqual(result.flashcards, []);
  assert.equal(result.sourceMode, "based_on_user_supplied_content");
  assert.ok(result.revisionChecklist.length > 0);
});

test("study-pack normalization rejects malformed JSON, empty sections and invalid quiz options", () => {
  assert.throws(() => normalizeStudyPackResult("{not json", { topic: "T", format: "mixed" }), { code: "STUDY_PACK_INVALID_JSON" });
  assert.throws(() => normalizeStudyPackResult({
    ...generatedPack,
    quiz: generatedPack.quiz.map(item => ({ ...item, answerIndex: 9 }))
  }, { topic: "T", format: "mixed" }), { code: "STUDY_PACK_INCOMPLETE" });
});

test("task router narrows flashcard/quiz requests to the study-pack tool", () => {
  const route = classifyTaskRoute("Make 5 flashcards and a short quiz about photosynthesis.");
  assert.equal(route.tier, "medium");
  assert.ok(route.categories.includes("study"));
  assert.equal(route.filtered, true);
  assert.deepEqual(route.toolNames, ["create_study_pack"]);
});

test("agent creates a structured study pack through its configured provider", async () => {
  let providerCalls = 0;
  let toolCalls = 0;
  let generationCalls = 0;
  let schemaNames;

  await withAgentServer({ OPENROUTER_API_KEY: "study-mode-test-provider-key" }, async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    const payload = JSON.parse(options.body);
    const messagesText = payload.messages.map(message => typeof message.content === "string" ? message.content : "").join("\n");

    if (messagesText.includes("structured study-pack generator")) {
      generationCalls += 1;
      assert.equal(Object.hasOwn(payload, "tools"), false, "nested study generation must not run external tools");
      const userMessage = payload.messages.find(message => message.role === "user");
      const request = JSON.parse(userMessage.content);
      assert.equal(request.topic, "photosynthesis");
      assert.equal(request.level, "beginner");
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: JSON.stringify(generatedPack) } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    schemaNames ||= (payload.tools || []).map(tool => tool.function.name);
    const hasStudyResult = payload.messages.some(message =>
      message.role === "tool" && typeof message.content === "string" && message.content.includes("AI-generated study aid")
    );
    if (hasStudyResult) {
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "I created a draft study pack with flashcards, a quiz and revision checklist." } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    toolCalls += 1;
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: "study-pack-call-1",
            type: "function",
            function: {
              name: "create_study_pack",
              arguments: JSON.stringify({
                topic: "photosynthesis",
                level: "beginner",
                format: "mixed",
                language: "English",
                questionCount: 3
              })
            }
          }]
        }
      }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Make flashcards and a quiz about photosynthesis for a beginner." })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /created a draft study pack/i);
    assert.ok(body.routing.categories.includes("study"));
    assert.deepEqual(schemaNames, ["create_study_pack"]);
    assert.deepEqual(body.toolsUsed.map(item => item.name), ["create_study_pack"]);
    assert.equal(body.toolsUsed[0].ok, true);
    assert.equal(body.toolResults[0].result.state, "completed");
    assert.equal(body.toolResults[0].result.quiz[0].answerIndex, 1);
    assert.equal(body.toolResults[0].result.sourceMode, "general_knowledge_draft");
  });

  assert.equal(providerCalls, 3);
  assert.equal(toolCalls, 1);
  assert.equal(generationCalls, 1);
});
