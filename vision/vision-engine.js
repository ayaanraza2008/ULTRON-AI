/**
 * ULTRON AI — Multimodal Vision & Environmental Awareness Engine
 *
 * Implements camera frame ingestion, screen content analysis,
 * bounding box / UI navigation helpers, multi-image comparison,
 * and security redaction of sensitive visual credentials.
 */

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB max to protect 8GB RAM
const SENSITIVE_TEXT_PATTERNS = [
  /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, // JWT
  /\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{36,}\b/g, // GitHub tokens
  /\bsk-[A-Za-z0-9]{32,}\b/g, // OpenAI/OpenRouter keys
  /\b(?:\d{4}[ -]?){3}\d{4}\b/g // Credit cards
];

export class JarvisVisionEngine {
  constructor(options = {}) {
    this.maxBytes = options.maxBytes || MAX_IMAGE_BYTES;
    this.visualMemory = [];
    this.maxVisualMemoryItems = 20;
  }

  /**
   * Validate and bound visual input payload.
   */
  validateImageInput(imageData) {
    if (!imageData || typeof imageData !== "object") {
      return { valid: false, error: "INVALID_IMAGE_PAYLOAD" };
    }

    let byteLength = 0;
    let format = "unknown";

    if (Buffer.isBuffer(imageData.buffer)) {
      byteLength = imageData.buffer.length;
      format = imageData.format || "jpeg";
    } else if (typeof imageData.dataUrl === "string") {
      const match = imageData.dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
      if (!match) return { valid: false, error: "INVALID_DATA_URL" };
      format = match[1];
      byteLength = Math.floor((match[2].length * 3) / 4);
    } else {
      return { valid: false, error: "UNSUPPORTED_IMAGE_FORMAT" };
    }

    if (byteLength > this.maxBytes) {
      return {
        valid: false,
        error: "IMAGE_TOO_LARGE",
        byteLength,
        maxBytes: this.maxBytes,
        message: `Image exceeds maximum allowed size of ${this.maxBytes / 1024 / 1024} MB.`
      };
    }

    return { valid: true, format, byteLength };
  }

  /**
   * Redact sensitive credentials detected in visual OCR text before cloud routing.
   */
  sanitizeOcrText(rawText) {
    if (typeof rawText !== "string") return "";
    let sanitized = rawText;
    for (const pattern of SENSITIVE_TEXT_PATTERNS) {
      sanitized = sanitized.replace(pattern, "[REDACTED_CREDENTIAL]");
    }
    return sanitized;
  }

  /**
   * Parse screen UI elements and return structured interaction targets.
   */
  parseScreenElements(elements = []) {
    if (!Array.isArray(elements)) return [];
    return elements.map((el, idx) => ({
      id: el.id || `el-${idx + 1}`,
      type: el.type || "button",
      label: typeof el.label === "string" ? el.label.slice(0, 100) : "",
      bounds: {
        x: Number(el.x) || 0,
        y: Number(el.y) || 0,
        width: Number(el.width) || 0,
        height: Number(el.height) || 0
      },
      clickable: Boolean(el.clickable ?? true)
    }));
  }

  /**
   * Compare two visual frames (e.g. before and after an action) to detect changes.
   */
  compareFrames(beforeMeta, afterMeta) {
    if (!beforeMeta || !afterMeta) {
      return { changed: false, confidence: 0, reason: "MISSING_FRAME_DATA" };
    }

    const byteDiff = Math.abs((beforeMeta.byteLength || 0) - (afterMeta.byteLength || 0));
    const isSignificant = byteDiff > 1024; // > 1 KB size change indicates UI state shift

    return {
      changed: isSignificant,
      byteDifference: byteDiff,
      beforeTimestamp: beforeMeta.timestamp,
      afterTimestamp: afterMeta.timestamp,
      summary: isSignificant ? "Visual change detected on target screen" : "No significant screen update detected"
    };
  }

  /**
   * Store visual context item in short-term visual memory.
   */
  storeVisualContext(item) {
    const entry = {
      id: "vis-" + Date.now(),
      timestamp: new Date().toISOString(),
      type: item.type || "screenshot",
      description: typeof item.description === "string" ? item.description.slice(0, 500) : "",
      elementsCount: Array.isArray(item.elements) ? item.elements.length : 0
    };
    this.visualMemory.push(entry);
    if (this.visualMemory.length > this.maxVisualMemoryItems) {
      this.visualMemory.shift();
    }
    return entry;
  }

  getVisualContext(limit = 5) {
    return this.visualMemory.slice(-limit);
  }
}
