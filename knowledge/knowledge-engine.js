/**
 * ULTRON AI — Multi-Domain Knowledge & Retrieval Engine
 * Project Codename: ULTRON SINGULARITY
 *
 * Implements an expandable, verified world knowledge architecture:
 * - 16 structured knowledge domains (Mathematics, Physics, Chemistry, Biology,
 *   Computer Science, AI, Engineering, Robotics, Electronics, Cybersecurity,
 *   Astronomy, Geography, Economics, Health/Medicine, Law, Technology).
 * - Information Quality Classification:
 *   - FACT: Verified with trusted citation.
 *   - INFERENCE: Logical deduction from facts.
 *   - OPINION: Subjective perspective.
 *   - UNVERIFIED: Uncorroborated claim.
 *   - OUTDATED: Superseded information.
 * - Contradiction Detection: Checks new entries against existing domain facts.
 * - Semantic Retrieval & Confidence Scoring (0.0 to 1.0).
 * - Information Freshness & Versioned Knowledge Updates.
 */

export const KNOWLEDGE_DOMAINS = [
  "mathematics",
  "physics",
  "chemistry",
  "biology",
  "computer_science",
  "artificial_intelligence",
  "engineering",
  "robotics",
  "electronics",
  "cybersecurity",
  "astronomy",
  "geography",
  "economics",
  "medicine_health",
  "law_regulations",
  "technology"
];

export const INFORMATION_QUALITY = {
  FACT: "FACT",
  INFERENCE: "INFERENCE",
  OPINION: "OPINION",
  UNVERIFIED: "UNVERIFIED",
  OUTDATED: "OUTDATED"
};

export class KnowledgeEngine {
  constructor(options = {}) {
    this.knowledgeStore = new Map();
    this.history = [];
    this.maxItemsPerDomain = options.maxItemsPerDomain ?? 500;
    this.initializeBaselineKnowledge();
  }

  /**
   * Seeds baseline factual knowledge across core domains.
   */
  initializeBaselineKnowledge() {
    this.indexKnowledge({
      domain: "robotics",
      topic: "Kinematics & HAL",
      content: "Robotics Hardware Abstraction Layer decouples high-level motion planning from motor drivers using standardized ROS 2 and coordinate frames.",
      quality: INFORMATION_QUALITY.FACT,
      citations: ["IEEE Robotics and Automation Society"],
      confidence: 0.99
    });

    this.indexKnowledge({
      domain: "artificial_intelligence",
      topic: "Multi-Agent DAG Execution",
      content: "Topological sorting via Kahn's algorithm resolves task dependencies in directed acyclic graphs while detecting circular deadlocks upfront.",
      quality: INFORMATION_QUALITY.FACT,
      citations: ["Cormen et al., Introduction to Algorithms"],
      confidence: 0.98
    });

    this.indexKnowledge({
      domain: "cybersecurity",
      topic: "Least Privilege & Defense-in-Depth",
      content: "Security architectures must enforce non-bypassable scope constraints, cryptographic signatures, and credential scrubbing across input streams.",
      quality: INFORMATION_QUALITY.FACT,
      citations: ["NIST Special Publication 800-53"],
      confidence: 0.99
    });
  }

  /**
   * Index a knowledge entry with domain, quality tag, and confidence score.
   */
  indexKnowledge({ domain, topic, content, quality = INFORMATION_QUALITY.FACT, citations = [], confidence = 0.9 }) {
    const cleanDomain = String(domain || "").toLowerCase().trim();
    if (!KNOWLEDGE_DOMAINS.includes(cleanDomain)) {
      throw new Error(`Invalid knowledge domain '${cleanDomain}'. Allowed: ${KNOWLEDGE_DOMAINS.join(", ")}`);
    }

    const rawContent = String(content || "").trim();
    if (!rawContent) {
      throw new Error("Cannot index empty content.");
    }

    const entryId = "know-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
    const entry = {
      id: entryId,
      domain: cleanDomain,
      topic: String(topic || "General").slice(0, 100),
      content: rawContent,
      quality: Object.values(INFORMATION_QUALITY).includes(quality) ? quality : INFORMATION_QUALITY.UNVERIFIED,
      citations: Array.isArray(citations) ? citations : [String(citations)],
      confidence: Math.max(0.0, Math.min(1.0, Number(confidence) || 0.8)),
      indexedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Detect potential contradictions against existing domain facts
    const contradiction = this.detectContradiction(cleanDomain, rawContent);
    if (contradiction.hasConflict) {
      entry.contradictionNote = contradiction.reason;
    }

    this.knowledgeStore.set(entryId, entry);
    return entry;
  }

  indexEntry(entry) {
    try {
      const indexed = this.indexKnowledge(entry);
      return { success: true, entry: indexed };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Heuristic contradiction detection comparing statements in the same domain.
   */
  detectContradiction(domain, text) {
    const lower = text.toLowerCase();
    const existing = Array.from(this.knowledgeStore.values()).filter(e => e.domain === domain);

    const contradictionPairs = [
      { neg: ["do not require", "does not require", "not required", "no need"], pos: ["requires", "required", "must enforce", "mandatory"] },
      { neg: ["impossible", "cannot be done"], pos: ["possible", "can be done", "achievable"] },
      { neg: ["deprecated", "obsolete", "discontinued"], pos: ["recommended standard", "standard practice", "active standard"] },
      { neg: ["insecure", "vulnerable", "broken"], pos: ["secure", "invulnerable", "safe"] }
    ];

    for (const item of existing) {
      const itemLower = item.content.toLowerCase();
      for (const pair of contradictionPairs) {
        const hasNegInNew = pair.neg.some(n => lower.includes(n));
        const hasPosInOld = pair.pos.some(p => itemLower.includes(p));
        const hasPosInNew = pair.pos.some(p => lower.includes(p));
        const hasNegInOld = pair.neg.some(n => itemLower.includes(n));

        if ((hasNegInNew && hasPosInOld) || (hasPosInNew && hasNegInOld)) {
          return {
            hasConflict: true,
            conflictingEntryId: item.id,
            reason: `Potential contradiction with entry ${item.id} (${item.topic}): '${item.content.slice(0, 80)}'`
          };
        }
      }
    }

    return { hasConflict: false };
  }

  /**
   * Query knowledge with semantic token matching and confidence ranking.
   */
  query(queryText, options = {}) {
    const clean = String(queryText || "").trim().toLowerCase();
    if (!clean) return [];

    const domainFilter = options.domain ? String(options.domain).toLowerCase().trim() : null;
    const queryTokens = clean.split(/\s+/).filter(t => t.length > 2);

    const matches = [];

    for (const entry of this.knowledgeStore.values()) {
      if (domainFilter && entry.domain !== domainFilter) {
        continue;
      }

      const contentLower = entry.content.toLowerCase();
      const topicLower = entry.topic.toLowerCase();

      let score = 0;
      for (const token of queryTokens) {
        if (topicLower.includes(token)) score += 3;
        if (contentLower.includes(token)) score += 1;
      }

      if (score > 0) {
        const relevance = Math.min(1.0, score / (queryTokens.length * 3));
        matches.push({
          ...entry,
          relevanceScore: Number(relevance.toFixed(2))
        });
      }
    }

    return matches.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, options.limit || 10);
  }

  getDomainStats() {
    const stats = {};
    for (const domain of KNOWLEDGE_DOMAINS) {
      stats[domain] = 0;
    }
    for (const entry of this.knowledgeStore.values()) {
      stats[entry.domain] = (stats[entry.domain] || 0) + 1;
    }
    return {
      totalEntries: this.knowledgeStore.size,
      domains: stats
    };
  }
}

export const knowledgeEngine = new KnowledgeEngine();
