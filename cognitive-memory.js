// Friday-inspired cognitive memory, adapted to ULTRON's existing Supabase schema.
// This module only ranks and classifies account-owned memories; it never executes tools.
const LAYERS = new Set(["working", "short_term", "episodic", "semantic", "procedural", "profile"]);
const LAYER_WEIGHT = {
  working: 0.6,
  short_term: 0.8,
  episodic: 1.0,
  semantic: 1.15,
  procedural: 1.25,
  profile: 1.3
};
const HALF_LIFE_DAYS = 45;
const MIN_DECAY_TO_INJECT = 0.15;
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "then", "when",
  "what", "which", "where", "while", "have", "has", "had", "are", "was",
  "were", "will", "would", "could", "should", "can", "not", "but", "into",
  "your", "you", "our", "about", "please", "make", "need", "want", "help",
  "hai", "ho", "kar", "karo", "mujhe", "mera", "meri", "mere",
  "aur", "mein", "me", "ko", "ka", "ki", "ke", "se", "to", "par", "pe"
]);

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function timestamp(value) {
  const parsed = typeof value === "number" ? value : Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function memoryUpdatedAt(item) {
  const metadata = objectOrEmpty(item?.metadata);
  // A reinforcement is a real memory event even if a database update trigger
  // does not refresh the row's updated_at timestamp.
  return Math.max(
    timestamp(item?.updated_at),
    timestamp(metadata.lastReinforcedAt),
    timestamp(item?.created_at)
  );
}

function tokens(value) {
  return new Set(
    String(value || "").toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter(word => word.length >= 3 && !STOP_WORDS.has(word))
  );
}

export function cognitiveLayerForMemory(item = {}) {
  const metadata = objectOrEmpty(item.metadata);
  const declared = typeof metadata.cognitiveLayer === "string"
    ? metadata.cognitiveLayer.toLowerCase().replace(/^l[1-6][-_ ]?/, "")
    : "";
  if (LAYERS.has(declared)) return declared;
  const title = String(item.title || "");
  if (/correction|response quality lesson|procedural lesson/i.test(title)) return "procedural";
  switch (item.kind) {
    case "preference":
    case "profile_note":
      return "profile";
    case "document_reference":
      return "episodic";
    case "project_fact":
      return "semantic";
    default:
      return "short_term";
  }
}

export function cognitiveLayerLabel(layer) {
  const labels = {
    working: "working context",
    short_term: "short-term recall",
    episodic: "episodic memory",
    semantic: "semantic knowledge",
    procedural: "learned response lesson",
    profile: "profile and preferences"
  };
  return labels[LAYERS.has(layer) ? layer : "short_term"];
}

/**
 * Rank a bounded set of account-owned Supabase rows for context injection.
 * Inferred memories decay with a 45-day half-life. Explicit user-approved
 * memories do not decay. Old inferred memories are hidden, never deleted.
 */
export function rankCognitiveMemories(items, query, { now = Date.now(), limit = 8 } = {}) {
  if (!Array.isArray(items) || !Number.isFinite(now)) return [];
  const queryTokens = tokens(query);
  const ranked = [];

  for (const item of items) {
    if (!item || typeof item !== "object" || typeof item.content !== "string" || !item.content.trim()) continue;
    const expiresAt = timestamp(item.expires_at);
    if (item.expires_at && expiresAt && expiresAt <= now) continue;

    const metadata = objectOrEmpty(item.metadata);
    const layer = cognitiveLayerForMemory(item);
    const updatedAt = memoryUpdatedAt(item);
    const ageDays = updatedAt ? Math.max(0, (now - updatedAt) / 86_400_000) : 0;
    const explicit = item.source === "user_approved" || metadata.explicit === true;
    const decay = explicit ? 1 : Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    if (!explicit && decay < MIN_DECAY_TO_INJECT) continue;

    const confidenceValue = Number(metadata.confidence);
    const confidence = Number.isFinite(confidenceValue)
      ? Math.max(0.25, Math.min(1, confidenceValue))
      : 0.75;
    const reinforcementValue = Number(metadata.reinforcementCount);
    const reinforcements = Number.isFinite(reinforcementValue)
      ? Math.max(1, Math.min(10, reinforcementValue))
      : 1;
    const memoryTokens = tokens((item.title || "") + " " + item.content);
    let overlap = 0;
    for (const token of queryTokens) if (memoryTokens.has(token)) overlap += 1;
    const relevance = queryTokens.size ? 0.65 + 2.1 * (overlap / queryTokens.size) : 1;
    const reinforcementBoost = Math.min(1.25, 1 + (reinforcements - 1) * 0.05);
    const score = (LAYER_WEIGHT[layer] || 0.8) * decay * confidence * relevance * reinforcementBoost;

    ranked.push({
      ...item,
      cognitiveLayer: layer,
      cognitiveScore: score,
      cognitiveDecay: decay
    });
  }

  return ranked
    .sort((a, b) => b.cognitiveScore - a.cognitiveScore ||
      memoryUpdatedAt(b) - memoryUpdatedAt(a))
    .slice(0, Math.max(0, Math.min(32, Math.trunc(limit) || 0)));
}

/**
 * Convert corrections into a small, reusable behaviour lesson. Never store the
 * user's raw correction text, which could contain private or secret information.
 */
export function extractCorrectionLesson(value) {
  const text = typeof value === "string" ? value.slice(0, 6000) : "";
  const correctionSignal = /\b(?:that's wrong|that is wrong|you(?:'ve| have)? misunderstood|not what i asked|i didn't ask|i did not ask|i said|wrong answer|not correct|that's not what|this is wrong|you got it wrong|galat|nahi samjhe|nahi samjha|aisa nahi|mera matlab)\b/i.test(text);
  if (!correctionSignal) return null;

  let content = "After a user correction, address the corrected requirement directly and avoid repeating the prior mistake.";
  if (/\b(?:short|brief|concise|vshort|quick revision|in short)\b/i.test(text)) {
    content = "When the user asks for a very short answer or quick revision, keep the response concise and focused.";
  } else if (/\b(?:english|hindi|hinglish|language|in english|in hindi)\b/i.test(text)) {
    content = "Follow the user's explicitly requested language for the current response; do not switch languages.";
  } else if (/\b(?:project|repository|repositories|repo|unrelated|production|deploy|permission|scope|other branch)\b/i.test(text)) {
    content = "Respect the user's explicit project and change-scope boundaries; do not modify unrelated repositories or production settings.";
  } else if (/\b(?:name|called|rename|not [a-z][a-z0-9_-]{1,30}|instead)\b/i.test(text)) {
    content = "Treat the user's latest explicit correction to a name or project identity as authoritative.";
  }

  return {
    kind: "profile_note",
    title: "Response quality lesson",
    content,
    cognitiveLayer: "procedural",
    confidence: 0.75
  };
}
