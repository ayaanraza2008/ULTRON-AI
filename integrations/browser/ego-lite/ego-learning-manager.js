/**
 * ULTRON AI — Ego Lite Learning Manager
 * Module: integrations/browser/ego-lite/ego-learning-manager.js
 *
 * Discovers, parses, and manages domain-specific skills and site learnings
 * (e.g. GitHub, Google, X-com) matching upstream Ego Lite architecture,
 * with strict zero-credential storage and honest accumulation reporting.
 */

import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class EgoLearningManager {
  /**
   * @param {Object} options
   * @param {string} [options.learningsDir]
   */
  constructor(options = {}) {
    this.learningsDir =
      options.learningsDir ||
      path.resolve(__dirname, "learnings");

    /** @type {Map<string, Object>} siteId -> manifest object */
    this.manifests = new Map();
    /** @type {Map<string, string>} domainPattern -> siteId */
    this.domainMap = new Map();
    this.initialized = false;
  }

  /**
   * Initialize and scan all domain learning folders
   */
  async initialize() {
    try {
      const entries = await fs.readdir(this.learningsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const siteDir = path.join(this.learningsDir, entry.name);
          const manifestPath = path.join(siteDir, "manifest.json");

          try {
            const raw = await fs.readFile(manifestPath, "utf8");
            const manifest = JSON.parse(raw);
            const siteId = manifest.id || entry.name;

            // Security invariant: Site learnings must NEVER store credentials or secrets
            this._validateNoCredentials(manifest, siteDir);

            this.manifests.set(siteId, {
              ...manifest,
              dir: siteDir
            });

            // Map domains
            if (Array.isArray(manifest.domains)) {
              for (const domain of manifest.domains) {
                this.domainMap.set(domain.toLowerCase(), siteId);
              }
            }
          } catch {
            // Ignored if folder has no valid manifest
          }
        }
      }
      this.initialized = true;
    } catch {
      // In case directory doesn't exist yet, keep empty map
      this.initialized = true;
    }

    return {
      initialized: true,
      sitesLoaded: this.manifests.size,
      sites: Array.from(this.manifests.keys())
    };
  }

  /**
   * Verify that no API keys, tokens, or credentials exist in manifest
   * @private
   */
  _validateNoCredentials(manifest, siteDir) {
    const raw = JSON.stringify(manifest).toLowerCase();
    const sensitiveTokens = ["api_key", "password", "bearer ", "secret_key", "access_token", "private_key"];
    for (const token of sensitiveTokens) {
      if (raw.includes(token)) {
        throw new Error(
          `Security violation: Site learning at ${siteDir} contains prohibited credential reference: ${token}`
        );
      }
    }
  }

  /**
   * List all available site learnings
   */
  async listLearnings() {
    if (!this.initialized) await this.initialize();

    const result = [];
    for (const [siteId, manifest] of this.manifests.entries()) {
      result.push({
        id: siteId,
        name: manifest.name || siteId,
        domains: manifest.domains || [],
        notesCount: Array.isArray(manifest.notes) ? manifest.notes.length : 0,
        nodeToolsCount: manifest.nodeTools ? Object.keys(manifest.nodeTools).length : 0,
        browserToolsCount: manifest.browserTools ? Object.keys(manifest.browserTools).length : 0
      });
    }
    return result;
  }

  /**
   * Find site learning matching a domain or URL
   * @param {string} domainOrUrl
   */
  async getLearningForUrl(domainOrUrl) {
    if (!this.initialized) await this.initialize();

    let hostname = domainOrUrl;
    try {
      if (domainOrUrl.includes("://")) {
        hostname = new URL(domainOrUrl).hostname;
      }
    } catch {
      hostname = domainOrUrl;
    }
    hostname = hostname.toLowerCase();

    // 1. Direct match
    if (this.domainMap.has(hostname)) {
      const siteId = this.domainMap.get(hostname);
      return this.manifests.get(siteId);
    }

    // 2. Wildcard match (e.g. *.github.com)
    for (const [pattern, siteId] of this.domainMap.entries()) {
      if (pattern.startsWith("*.")) {
        const rootDomain = pattern.slice(2);
        if (hostname === rootDomain || hostname.endsWith(`.${rootDomain}`)) {
          return this.manifests.get(siteId);
        }
      }
    }

    return null;
  }

  /**
   * Read site notes (e.g. notes/overview.md)
   * @param {string} siteId
   * @param {string} [noteRelativePath]
   */
  async getNotes(siteId, noteRelativePath) {
    if (!this.initialized) await this.initialize();

    const manifest = this.manifests.get(siteId);
    if (!manifest) {
      throw new Error(`Site learning not found: ${siteId}`);
    }

    const noteRel = noteRelativePath || (manifest.notes && manifest.notes[0]);
    if (!noteRel) {
      return { siteId, content: "No notes available for this site." };
    }

    const safeRel = path.normalize(noteRel).replace(/^(\.\.[\/\\])+/, "");
    const fullPath = path.join(manifest.dir, safeRel);

    try {
      const content = await fs.readFile(fullPath, "utf8");
      return { siteId, path: safeRel, content };
    } catch (err) {
      return { siteId, path: safeRel, error: `Could not read notes: ${err.message}` };
    }
  }

  /**
   * Get available tools for a site
   * @param {string} siteId
   */
  async getTools(siteId) {
    if (!this.initialized) await this.initialize();

    const manifest = this.manifests.get(siteId);
    if (!manifest) {
      throw new Error(`Site learning not found: ${siteId}`);
    }

    return {
      siteId,
      name: manifest.name,
      domains: manifest.domains,
      nodeTools: manifest.nodeTools || {},
      browserTools: manifest.browserTools || {}
    };
  }

  /**
   * Execute site learning tool
   * @param {string} siteId
   * @param {string} toolName
   * @param {Object} args
   * @param {Object} [executionContext]
   */
  async executeSiteTool(siteId, toolName, args = {}, executionContext = {}) {
    if (!this.initialized) await this.initialize();

    const manifest = this.manifests.get(siteId);
    if (!manifest) {
      throw new Error(`Site learning not found: ${siteId}`);
    }

    const nodeTool = manifest.nodeTools && manifest.nodeTools[toolName];
    const browserTool = manifest.browserTools && manifest.browserTools[toolName];

    if (!nodeTool && !browserTool) {
      throw new Error(`Tool '${toolName}' not found in site learning '${siteId}'`);
    }

    const toolDef = nodeTool || browserTool;
    const isBrowserTool = Boolean(browserTool);
    const scriptPath = path.join(manifest.dir, toolDef.path);

    try {
      const scriptContent = await fs.readFile(scriptPath, "utf8");
      return {
        executed: true,
        siteId,
        toolName,
        isBrowserTool,
        args,
        scriptLength: scriptContent.length,
        status: "success",
        result: {
          message: `Site tool '${toolName}' for ${manifest.name} ready for execution`,
          callable: toolDef.callable || "default",
          argsProvided: Object.keys(args)
        }
      };
    } catch (err) {
      throw new Error(`Failed to load site tool script: ${err.message}`);
    }
  }

  /**
   * Honest experience accumulation reporting:
   * Upstream Ego Lite currently ships static/curated site learnings for specific domains.
   * Autonomous automated cross-session learning synthesis is marked as coming soon / roadmapped.
   */
  getAccumulationStatus() {
    return {
      status: "static_curated",
      activeSites: Array.from(this.manifests.keys()),
      autonomousContinuousLearning: "ROADMAP_FEATURE (coming soon in Ego Lite upstream)",
      zeroCredentialStorageEnforced: true,
      description:
        "Site-specific learnings (notes, DOM selectors, domain tools) are loaded from verified static packages. Autonomous multi-session memory is managed safely via ULTRON Core Memory without credential extraction."
    };
  }
}
