"""
ULTRON ETERNAL — Project Cerebro Neural Knowledge Graph Engine
Hybrid Vector Graph with TF-IDF Semantic Retrieval, Entity Linking, and Multi-Hop Recall.
"""

import os
import json
import math
import re
from typing import Dict, List, Any, Optional

class CerebroEngine:
    def __init__(self, storage_dir: Optional[str] = None, user_id: str = "default_user"):
        if storage_dir is None:
            storage_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", ".local", "cerebro")
        self.storage_dir = os.path.abspath(storage_dir)
        self.user_id = re.sub(r'[^a-zA-Z0-9_\-]', '', user_id)
        os.makedirs(self.storage_dir, exist_ok=True)
        self.db_path = os.path.join(self.storage_dir, f"cerebro_{self.user_id}.json")
        self._load()

    def _load(self):
        if os.path.exists(self.db_path):
            try:
                with open(self.db_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.nodes = data.get("nodes", {})
                    self.edges = data.get("edges", [])
                    return
            except Exception:
                pass
        self.nodes = {}
        self.edges = []

    def _save(self):
        data = {
            "version": "1.0.0",
            "user_id": self.user_id,
            "nodes": self.nodes,
            "edges": self.edges
        }
        temp_path = self.db_path + ".tmp"
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        if os.path.exists(self.db_path):
            os.replace(temp_path, self.db_path)
        else:
            os.rename(temp_path, self.db_path)

    def _tokenize(self, text: str) -> List[str]:
        return [w.lower() for w in re.findall(r'\b[a-zA-Z0-9_]{2,}\b', text or "")]

    def _build_tf(self, tokens: List[str]) -> Dict[str, float]:
        tf = {}
        if not tokens:
            return tf
        for t in tokens:
            tf[t] = tf.get(t, 0.0) + 1.0
        max_freq = max(tf.values())
        return {k: 0.5 + 0.5 * (v / max_freq) for k, v in tf.items()}

    def _cosine_similarity(self, vec1: Dict[str, float], vec2: Dict[str, float]) -> float:
        dot = sum(vec1.get(k, 0.0) * v for k, v in vec2.items())
        norm1 = math.sqrt(sum(v * v for v in vec1.values()))
        norm2 = math.sqrt(sum(v * v for v in vec2.values()))
        if norm1 == 0.0 or norm2 == 0.0:
            return 0.0
        return dot / (norm1 * norm2)

    def upsert_node(self, node_id: str, label: str, content: str, node_type: str = "entity", metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        node_id = str(node_id).strip()
        tokens = self._tokenize(f"{label} {content}")
        node = {
            "id": node_id,
            "label": label,
            "content": content,
            "type": node_type,
            "metadata": metadata or {},
            "tokens": tokens,
            "updated_at": os.path.getmtime(self.db_path) if os.path.exists(self.db_path) else 0.0
        }
        self.nodes[node_id] = node
        self._save()
        return {"success": True, "node_id": node_id, "label": label, "token_count": len(tokens)}

    def link_entities(self, source_id: str, target_id: str, relation: str = "relates_to", weight: float = 1.0, bidirectional: bool = True) -> Dict[str, Any]:
        source_id = str(source_id).strip()
        target_id = str(target_id).strip()
        if source_id not in self.nodes or target_id not in self.nodes:
            missing = [x for x in (source_id, target_id) if x not in self.nodes]
            return {"success": False, "error": f"Node(s) not found in Cerebro: {missing}"}

        # Check existing edge
        updated = False
        for edge in self.edges:
            if edge["source"] == source_id and edge["target"] == target_id and edge["relation"] == relation:
                edge["weight"] = weight
                updated = True
                break
        if not updated:
            self.edges.append({
                "source": source_id,
                "target": target_id,
                "relation": relation,
                "weight": float(weight)
            })

        if bidirectional:
            b_updated = False
            for edge in self.edges:
                if edge["source"] == target_id and edge["target"] == source_id and edge["relation"] == relation:
                    edge["weight"] = weight
                    b_updated = True
                    break
            if not b_updated:
                self.edges.append({
                    "source": target_id,
                    "target": source_id,
                    "relation": relation,
                    "weight": float(weight)
                })

        self._save()
        return {"success": True, "source": source_id, "target": target_id, "relation": relation, "weight": weight}

    def semantic_query(self, query: str, top_k: int = 5) -> Dict[str, Any]:
        q_tokens = self._tokenize(query)
        if not q_tokens or not self.nodes:
            return {"success": True, "query": query, "results": [], "total_nodes": len(self.nodes)}

        q_tf = self._build_tf(q_tokens)

        # Compute document frequency across corpus
        df = {}
        for node in self.nodes.values():
            unique_terms = set(node.get("tokens", []))
            for term in unique_terms:
                df[term] = df.get(term, 0) + 1

        n_docs = len(self.nodes)
        idf = {k: math.log(1.0 + (n_docs / (v + 1.0))) for k, v in df.items()}

        q_vec = {k: v * idf.get(k, 1.0) for k, v in q_tf.items()}

        scored = []
        for node_id, node in self.nodes.items():
            doc_tf = self._build_tf(node.get("tokens", []))
            doc_vec = {k: v * idf.get(k, 1.0) for k, v in doc_tf.items()}
            score = self._cosine_similarity(q_vec, doc_vec)
            if score > 0.05:
                # Find direct connected neighbors
                neighbors = []
                for edge in self.edges:
                    if edge["source"] == node_id:
                        neighbors.append({"target": edge["target"], "relation": edge["relation"], "weight": edge["weight"]})
                scored.append({
                    "id": node_id,
                    "label": node["label"],
                    "content": node["content"],
                    "type": node["type"],
                    "similarity": round(score, 4),
                    "connections": neighbors[:5]
                })

        scored.sort(key=lambda x: x["similarity"], reverse=True)
        return {
            "success": True,
            "query": query,
            "results": scored[:top_k],
            "matches_found": len(scored)
        }

    def multi_hop_recall(self, start_id: str, target_id: Optional[str] = None, max_hops: int = 3) -> Dict[str, Any]:
        start_id = str(start_id).strip()
        if start_id not in self.nodes:
            return {"success": False, "error": f"Start node '{start_id}' not found."}

        # Build adjacency graph
        adj = {}
        for edge in self.edges:
            s, t = edge["source"], edge["target"]
            if s not in adj:
                adj[s] = []
            adj[s].append((t, edge["relation"], edge["weight"]))

        visited = {start_id: 0}
        queue = [(start_id, [start_id], [])]
        paths_found = []
        subgraph_nodes = {start_id: self.nodes[start_id]}
        subgraph_edges = []

        while queue:
            curr, path, relations = queue.pop(0)
            curr_hops = len(path) - 1

            if target_id and curr == target_id and len(path) > 1:
                paths_found.append({"path": path, "relations": relations, "hops": curr_hops})
                continue

            if curr_hops >= max_hops:
                continue

            for neighbor, rel, weight in adj.get(curr, []):
                subgraph_edges.append({"source": curr, "target": neighbor, "relation": rel, "weight": weight})
                if neighbor not in subgraph_nodes and neighbor in self.nodes:
                    subgraph_nodes[neighbor] = self.nodes[neighbor]

                if neighbor not in visited or visited[neighbor] >= curr_hops + 1:
                    visited[neighbor] = curr_hops + 1
                    queue.append((neighbor, path + [neighbor], relations + [rel]))

        return {
            "success": True,
            "start_id": start_id,
            "target_id": target_id,
            "max_hops": max_hops,
            "paths": paths_found,
            "subgraph": {
                "nodes": [{"id": k, "label": v["label"], "type": v["type"]} for k, v in subgraph_nodes.items()],
                "edges": subgraph_edges[:50]
            }
        }

    def get_metrics(self) -> Dict[str, Any]:
        node_count = len(self.nodes)
        edge_count = len(self.edges)
        density = (2.0 * edge_count) / (node_count * (node_count - 1)) if node_count > 1 else 0.0

        # Degree calculation
        degrees = {}
        for edge in self.edges:
            s = edge["source"]
            degrees[s] = degrees.get(s, 0) + 1

        top_entities = sorted(degrees.items(), key=lambda x: x[1], reverse=True)[:5]
        top_details = [{"id": k, "label": self.nodes.get(k, {}).get("label", k), "degree": v} for k, v in top_entities]

        return {
            "success": True,
            "user_id": self.user_id,
            "node_count": node_count,
            "edge_count": edge_count,
            "graph_density": round(density, 4),
            "central_entities": top_details
        }
