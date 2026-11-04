/**
 * ULTRON AI — Diagram Design & Visual Architecture Engine
 * Evaluates and integrates visual planning capabilities from cathrynlavery/diagram-design
 *
 * Generates standards-compliant Mermaid diagrams and self-contained SVG architecture
 * visualizations for ULTRON's engineering, research, and documentation agents.
 */

export const DIAGRAM_TYPES = {
  FLOWCHART: "flowchart",
  SEQUENCE: "sequence",
  STATE: "state",
  CLASS: "class",
  ER: "er",
  SVG_ARCHITECTURE: "svg_architecture"
};

export class DiagramDesignEngine {
  constructor(options = {}) {
    this.defaultTheme = options.theme || "dark";
    this.defaultDirection = options.direction || "TD";
  }

  /**
   * Generates a valid Mermaid flowchart with escaped/quoted node labels.
   */
  generateFlowchart({ title = "", direction = "TD", nodes = [], edges = [] } = {}) {
    const lines = [];
    if (title) {
      lines.push(`%% Title: ${title}`);
    }
    lines.push(`flowchart ${direction}`);

    for (const node of nodes) {
      const id = String(node.id).replace(/[^a-zA-Z0-9_]/g, "_");
      const label = String(node.label || node.id).replace(/"/g, "'");
      const shape = node.shape || "rectangle";

      if (shape === "round") {
        lines.push(`    ${id}("${label}")`);
      } else if (shape === "cylinder" || shape === "database") {
        lines.push(`    ${id}[("${label}")]`);
      } else if (shape === "diamond" || shape === "decision") {
        lines.push(`    ${id}{"${label}"}`);
      } else {
        lines.push(`    ${id}["${label}"]`);
      }
    }

    for (const edge of edges) {
      const from = String(edge.from).replace(/[^a-zA-Z0-9_]/g, "_");
      const to = String(edge.to).replace(/[^a-zA-Z0-9_]/g, "_");
      const label = edge.label ? `|"${String(edge.label).replace(/"/g, "'")}"|` : "";
      const arrow = edge.style === "dotted" ? "-.->" : edge.style === "thick" ? "==>" : "-->";
      lines.push(`    ${from} ${arrow}${label} ${to}`);
    }

    const rawMermaid = lines.join("\n");
    return {
      type: DIAGRAM_TYPES.FLOWCHART,
      title,
      direction,
      rawMermaid,
      markdownBlock: "```mermaid\n" + rawMermaid + "\n```",
      nodeCount: nodes.length,
      edgeCount: edges.length
    };
  }

  /**
   * Generates a valid Mermaid sequence diagram.
   */
  generateSequenceDiagram({ title = "", participants = [], messages = [] } = {}) {
    const lines = [];
    if (title) {
      lines.push(`%% Title: ${title}`);
    }
    lines.push("sequenceDiagram");
    lines.push("    autonumber");

    for (const part of participants) {
      const id = String(part.id || part).replace(/[^a-zA-Z0-9_]/g, "_");
      const label = String(part.label || part.id || part).replace(/"/g, "'");
      lines.push(`    participant ${id} as "${label}"`);
    }

    for (const msg of messages) {
      const from = String(msg.from).replace(/[^a-zA-Z0-9_]/g, "_");
      const to = String(msg.to).replace(/[^a-zA-Z0-9_]/g, "_");
      const text = String(msg.text || "").replace(/"/g, "'");
      const arrow = msg.type === "reply" ? "-->>" : "->>";
      lines.push(`    ${from}${arrow}${to}: ${text}`);
    }

    const rawMermaid = lines.join("\n");
    return {
      type: DIAGRAM_TYPES.SEQUENCE,
      title,
      rawMermaid,
      markdownBlock: "```mermaid\n" + rawMermaid + "\n```",
      participantCount: participants.length,
      messageCount: messages.length
    };
  }

  /**
   * Generates a clean, standalone SVG architecture block.
   */
  generateArchitectureSvg({ title = "System Architecture", components = [], width = 800, height = 400 } = {}) {
    const compElements = components.map((comp, index) => {
      const x = comp.x || (40 + (index % 4) * 180);
      const y = comp.y || (70 + Math.floor(index / 4) * 110);
      const w = comp.width || 150;
      const h = comp.height || 70;
      const name = String(comp.name || "Component").slice(0, 24);
      const desc = String(comp.desc || "").slice(0, 32);
      const color = comp.color || "#0284c7";

      return `
    <g class="component" id="comp-${index}">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#1e293b" stroke="${color}" stroke-width="2" />
      <text x="${x + 12}" y="${y + 28}" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="13" font-weight="bold">${name}</text>
      <text x="${x + 12}" y="${y + 48}" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="10">${desc}</text>
    </g>`;
    }).join("");

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <style>
    .bg { fill: #0f172a; }
    .title { fill: #38bdf8; font-family: system-ui, sans-serif; font-size: 16px; font-weight: bold; }
  </style>
  <rect width="100%" height="100%" class="bg" rx="12" />
  <text x="24" y="34" class="title">${title}</text>
  ${compElements}
</svg>`;

    return {
      type: DIAGRAM_TYPES.SVG_ARCHITECTURE,
      title,
      width,
      height,
      svg,
      componentCount: components.length
    };
  }

  /**
   * Validates basic Mermaid syntax integrity.
   */
  validateMermaid(code = "") {
    const trimmed = String(code).trim();
    if (!trimmed) {
      return { valid: false, error: "Mermaid code cannot be empty." };
    }

    const validHeaders = ["flowchart", "graph", "sequenceDiagram", "stateDiagram", "classDiagram", "erDiagram"];
    const lines = trimmed.split("\n").map(l => l.trim()).filter(Boolean);
    const firstNonComment = lines.find(l => !l.startsWith("%%"));

    if (!firstNonComment) {
      return { valid: false, error: "Mermaid diagram missing definition header." };
    }

    const matchesHeader = validHeaders.some(h => firstNonComment.startsWith(h));
    if (!matchesHeader) {
      return { valid: false, error: `Invalid diagram header '${firstNonComment}'. Supported: ${validHeaders.join(", ")}` };
    }

    return { valid: true, diagramType: firstNonComment.split(/\s+/)[0] };
  }
}

export const diagramDesignEngine = new DiagramDesignEngine();
