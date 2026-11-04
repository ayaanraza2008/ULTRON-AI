/**
 * ULTRON AI — Project Cerebro Hybrid Knowledge Vault
 *
 * Implements an infinite neural memory vector graph with TF-IDF cosine similarity,
 * entity relationship linking, multi-hop recall, and strict user isolation.
 * Fully operable in pure Node.js with optional Python capability runtime acceleration.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class CerebroKnowledgeVault {
  constructor(options = {}) {
    this.storageDir = options.storageDir || path.resolve(process.cwd(), ".local", "cerebro");
    this.memoryGraphs = new Map(); // userId -> { nodes: Map, edges: [] }
    fs.mkdirSync(this.storageDir, { recursive: true });
  }

  _sanitizeUserId(userId) {
    if (!userId || typeof userId !== "string") return "default_user";
    return userId.replace(/[^a-zA-Z0-9_\-]/g, "");
  }

  _getUserGraph(userId) {
    const safeId = this._sanitizeUserId(userId);
    if (!this.memoryGraphs.has(safeId)) {
      const graph = {
        userId: safeId,
        nodes: new Map(),
        edges: []
      };
      // Try to load persisted
      const fp = path.join(this.storageDir, `cerebro_${safeId}.json`);
      if (fs.existsSync(fp)) {
        try {
          const raw = JSON.parse(fs.readFileSync(fp, "utf8"));
          if (raw.nodes) {
            for (const [k, v] of Object.entries(raw.nodes)) {
              graph.nodes.set(k, v);
            }
          }
          if (Array.isArray(raw.edges)) {
            graph.edges = raw.edges;
          }
        } catch (_) {}
      }
      this.memoryGraphs.set(safeId, graph);
    }
    return this.memoryGraphs.get(safeId);
  }

  _persistUserGraph(userId) {
    const safeId = this._sanitizeUserId(userId);
    const graph = this._getUserGraph(safeId);
    const fp = path.join(this.storageDir, `cerebro_${safeId}.json`);
    const nodesObj = {};
    for (const [k, v] of graph.nodes.entries()) {
      nodesObj[k] = v;
    }
    const data = {
      version: "1.0.0",
      userId: safeId,
      nodes: nodesObj,
      edges: graph.edges,
      updatedAt: Date.now()
    };
    fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf8");
  }

  _tokenize(text) {
    if (!text || typeof text !== "string") return [];
    return text.toLowerCase().match(/\b[a-z0-9_]{2,}\b/g) || [];
  }

  _computeTf(tokens) {
    const tf = {};
    if (!tokens.length) return tf;
    for (const t of tokens) {
      tf[t] = (tf[t] || 0) + 1;
    }
    const maxVal = Math.max(...Object.values(tf));
    for (const k of Object.keys(tf)) {
      tf[k] = 0.5 + 0.5 * (tf[k] / maxVal);
    }
    return tf;
  }

  _cosineSimilarity(vecA, vecB) {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (const [k, val] of Object.entries(vecA)) {
      normA += val * val;
      if (vecB[k]) {
        dot += val * vecB[k];
      }
    }
    for (const val of Object.values(vecB)) {
      normB += val * val;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Stores or updates an entity node with tokenized content and metadata.
   */
  async upsertNode(userId, node) {
    const graph = this._getUserGraph(userId);
    const nodeId = String(node.id || node.nodeId || "").trim();
    if (!nodeId) throw new Error("Entity node requires a non-empty 'id'");

    const label = node.label || nodeId;
    const content = node.content || "";
    const tokens = this._tokenize(`${label} ${content}`);

    const entity = {
      id: nodeId,
      label,
      content,
      type: node.type || "entity",
      metadata: node.metadata || {},
      tokens,
      updatedAt: Date.now()
    };

    graph.nodes.set(nodeId, entity);
    this._persistUserGraph(userId);

    return {
      success: true,
      nodeId,
      label,
      tokenCount: tokens.length
    };
  }

  /**
   * Creates a weighted relationship between two entity nodes.
   */
  async linkEntities(userId, { sourceId, targetId, relation = "relates_to", weight = 1.0, bidirectional = true }) {
    const graph = this._getUserGraph(userId);
    const sId = String(sourceId).trim();
    const tId = String(targetId).trim();

    if (!graph.nodes.has(sId) || !graph.nodes.has(tId)) {
      const missing = [];
      if (!graph.nodes.has(sId)) missing.push(sId);
      if (!graph.nodes.has(tId)) missing.push(tId);
      throw new Error(`Node(s) not found in Cerebro for user: ${missing.join(", ")}`);
    }

    const w = Number(weight) || 1.0;
    const existing = graph.edges.find(e => e.source === sId && e.target === tId && e.relation === relation);
    if (existing) {
      existing.weight = w;
    } else {
      graph.edges.push({ source: sId, target: tId, relation, weight: w });
    }

    if (bidirectional) {
      const existingRev = graph.edges.find(e => e.source === tId && e.target === sId && e.relation === relation);
      if (existingRev) {
        existingRev.weight = w;
      } else {
        graph.edges.push({ source: tId, target: sId, relation, weight: w });
      }
    }

    this._persistUserGraph(userId);
    return {
      success: true,
      source: sId,
      target: tId,
      relation,
      weight: w,
      bidirectional
    };
  }

  /**
   * Semantic cosine similarity search using corpus-wide TF-IDF vectors.
   */
  async semanticQuery(userId, queryText, topK = 5) {
    const graph = this._getUserGraph(userId);
    const qTokens = this._tokenize(queryText);
    if (!qTokens.length || graph.nodes.size === 0) {
      return { success: true, query: queryText, results: [], totalNodes: graph.nodes.size };
    }

    const qTf = this._computeTf(qTokens);

    // Compute Document Frequency (DF) across graph corpus
    const df = {};
    for (const node of graph.nodes.values()) {
      const unique = new Set(node.tokens);
      for (const t of unique) {
        df[t] = (df[t] || 0) + 1;
      }
    }

    const nDocs = graph.nodes.size;
    const idf = {};
    for (const [k, v] of Object.entries(df)) {
      idf[k] = Math.log(1.0 + nDocs / (v + 1.0));
    }

    const qVec = {};
    for (const [k, v] of Object.entries(qTf)) {
      qVec[k] = v * (idf[k] || 1.0);
    }

    const scored = [];
    for (const [nodeId, node] of graph.nodes.entries()) {
      const docTf = this._computeTf(node.tokens);
      const docVec = {};
      for (const [k, v] of Object.entries(docTf)) {
        docVec[k] = v * (idf[k] || 1.0);
      }
      const similarity = this._cosineSimilarity(qVec, docVec);
      if (similarity > 0.05) {
        const connections = graph.edges
          .filter(e => e.source === nodeId)
          .map(e => ({ target: e.target, relation: e.relation, weight: e.weight }))
          .slice(0, 5);

        scored.push({
          id: nodeId,
          label: node.label,
          content: node.content,
          type: node.type,
          similarity: Number(similarity.toFixed(4)),
          connections
        });
      }
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return {
      success: true,
      query: queryText,
      results: scored.slice(0, topK),
      matchesFound: scored.length
    };
  }

  /**
   * Multi-hop breadth-first traversal between entities.
   */
  async multiHopRecall(userId, { startId, targetId = null, maxHops = 3 }) {
    const graph = this._getUserGraph(userId);
    const sId = String(startId).trim();
    const tId = targetId ? String(targetId).trim() : null;

    if (!graph.nodes.has(sId)) {
      throw new Error(`Start entity node '${sId}' does not exist.`);
    }

    const adj = new Map();
    for (const edge of graph.edges) {
      if (!adj.has(edge.source)) adj.set(edge.source, []);
      adj.get(edge.source).push({ target: edge.target, relation: edge.relation, weight: edge.weight });
    }

    const visited = new Map([[sId, 0]]);
    const queue = [[sId, [sId], []]];
    const paths = [];
    const subgraphNodes = new Map([[sId, graph.nodes.get(sId)]]);
    const subgraphEdges = [];

    while (queue.length > 0) {
      const [curr, pathArr, rels] = queue.shift();
      const hops = pathArr.length - 1;

      if (tId && curr === tId && pathArr.length > 1) {
        paths.push({ path: pathArr, relations: rels, hops });
        continue;
      }

      if (hops >= maxHops) continue;

      const neighbors = adj.get(curr) || [];
      for (const n of neighbors) {
        subgraphEdges.push({ source: curr, target: n.target, relation: n.relation, weight: n.weight });
        if (graph.nodes.has(n.target) && !subgraphNodes.has(n.target)) {
          subgraphNodes.set(n.target, graph.nodes.get(n.target));
        }

        if (!visited.has(n.target) || visited.get(n.target) >= hops + 1) {
          visited.set(n.target, hops + 1);
          queue.push([n.target, [...pathArr, n.target], [...rels, n.relation]]);
        }
      }
    }

    return {
      success: true,
      startId: sId,
      targetId: tId,
      maxHops,
      paths,
      subgraph: {
        nodes: Array.from(subgraphNodes.values()).map(n => ({ id: n.id, label: n.label, type: n.type })),
        edges: subgraphEdges.slice(0, 50)
      }
    };
  }

  /**
   * Computes graph topological telemetry.
   */
  async getMetrics(userId) {
    const graph = this._getUserGraph(userId);
    const nodeCount = graph.nodes.size;
    const edgeCount = graph.edges.length;
    const density = nodeCount > 1 ? (2.0 * edgeCount) / (nodeCount * (nodeCount - 1)) : 0;

    const degrees = new Map();
    for (const edge of graph.edges) {
      degrees.set(edge.source, (degrees.get(edge.source) || 0) + 1);
    }

    const sorted = Array.from(degrees.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const centralEntities = sorted.map(([id, deg]) => ({
      id,
      label: graph.nodes.get(id)?.label || id,
      degree: deg
    }));

    return {
      success: true,
      userId: this._sanitizeUserId(userId),
      nodeCount,
      edgeCount,
      graphDensity: Number(density.toFixed(4)),
      centralEntities
    };
  }
}

export const cerebroKnowledgeVault = new CerebroKnowledgeVault();
