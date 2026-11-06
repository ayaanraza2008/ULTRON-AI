/**
 * ULTRON AI — Multi-Device Durable Persistence Adapters
 *
 * Implements extensible persistence backends for MultiDeviceManager:
 * 1. FilePersistenceAdapter: Atomic, AES-256-GCM encrypted local filesystem storage
 *    using temporary file + atomic rename (mode 0o600).
 * 2. DatabasePersistenceAdapter: Durable PostgreSQL / Supabase storage supporting:
 *    - Transactional state updates and monotonic version conflict detection.
 *    - Parameterized, prepared statements ensuring total immunity against CWE-89 SQL injection.
 *    - Full Supabase REST and native pg pool support with auto-reconnection and SSL support.
 *    - Automatic, resilient fallback to FilePersistenceAdapter when database is
 *      unconfigured, unreachable, or undergoing maintenance.
 * 3. BaseMultiDevicePersistenceAdapter: Abstract interface defining the persistence contract.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Constant parameterized SQL queries
const SQL_CREATE_STATE_TABLE =
  "CREATE TABLE IF NOT EXISTS ultron_multidevice_state (key TEXT PRIMARY KEY, value JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())";

const SQL_UPSERT_ROOT_STATE =
  "INSERT INTO ultron_multidevice_state (key, value, version, updated_at) VALUES ('root', $1, 1, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, version = ultron_multidevice_state.version + 1, updated_at = NOW()";

const SQL_SELECT_ROOT_STATE =
  "SELECT version, value FROM ultron_multidevice_state WHERE key = 'root' LIMIT 1";

const SQL_SELECT_ROOT_VERSION_FOR_UPDATE =
  "SELECT version FROM ultron_multidevice_state WHERE key = 'root' FOR UPDATE";

const SQL_SELECT_STATE_FOR_UPDATE =
  "SELECT version, value FROM ultron_multidevice_state WHERE key = $1 FOR UPDATE";

const SQL_UPSERT_NAMED_STATE =
  "INSERT INTO ultron_multidevice_state (key, value, version, updated_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, version = EXCLUDED.version, updated_at = NOW()";

/**
 * Encrypts a serialized state object at rest using authenticated AES-256-GCM.
 * If no encryption key is configured, outputs standard JSON for development compatibility.
 */
function encryptPayloadAtRest(dataObj, encryptionKey) {
  if (!encryptionKey) {
    return JSON.stringify(dataObj, null, 2);
  }
  const jsonContent = JSON.stringify(dataObj);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(jsonContent, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope = {
    encrypted: true,
    algorithm: "aes-256-gcm",
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ciphertext: encrypted.toString("hex"),
    savedAt: dataObj.savedAt || new Date().toISOString()
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Decrypts a state payload stored at rest. Preserves backwards compatibility
 * by seamlessly loading legacy/unencrypted JSON records.
 */
function decryptPayloadAtRest(rawText, encryptionKey, logger = null) {
  if (!rawText || !rawText.trim()) return null;
  let parsed;
  try {
    parsed = typeof rawText === "string" ? JSON.parse(rawText) : rawText;
  } catch (err) {
    if (logger?.warn) logger.warn("decryptPayloadAtRest: invalid JSON format", { error: err?.message });
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  if (parsed.encrypted === true && parsed.ciphertext && parsed.iv && parsed.tag) {
    if (!encryptionKey) {
      if (logger?.error) logger.error("decryptPayloadAtRest: encrypted persistence state found but master secret is unconfigured");
      throw new Error("ENCRYPTION_KEY_REQUIRED_FOR_PERSISTENCE");
    }
    try {
      const iv = Buffer.from(parsed.iv, "hex");
      const tag = Buffer.from(parsed.tag, "hex");
      const ciphertext = Buffer.from(parsed.ciphertext, "hex");
      const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return JSON.parse(decrypted.toString("utf8"));
    } catch (err) {
      if (logger?.error) logger.error("decryptPayloadAtRest: AES-256-GCM authentication or decryption failed", { error: err?.message });
      throw new Error("CORRUPTED_ENCRYPTED_PERSISTENCE_DATA");
    }
  }

  // Legacy/unencrypted state
  return parsed;
}

/**
 * Base abstract adapter defining the multi-device persistence contract.
 */
export class BaseMultiDevicePersistenceAdapter {
  async save(_state) {
    throw new Error("Method not implemented.");
  }

  async load() {
    throw new Error("Method not implemented.");
  }

  saveSync(_state) {
    throw new Error("Synchronous save not supported by this adapter.");
  }

  loadSync() {
    throw new Error("Synchronous load not supported by this adapter.");
  }

  async saveSharedState(_stateUpdate) {
    throw new Error("Method not implemented.");
  }

  async acknowledgeDelivery(_deviceId, _deliveryId) {
    throw new Error("Method not implemented.");
  }

  async revokeDevice(_deviceId, _meta) {
    throw new Error("Method not implemented.");
  }
}

/**
 * FilePersistenceAdapter — Atomic, single-instance durable storage.
 * Writes beside the target path to a PID-unique temporary file, applies
 * restrictive file modes (0o600), and replaces atomically via rename.
 * When ULTRON_DEVICE_SIGNING_SECRET or masterSecret is provided (>= 32 chars),
 * data is encrypted at rest using authenticated AES-256-GCM.
 */
export class FilePersistenceAdapter extends BaseMultiDevicePersistenceAdapter {
  constructor(options = {}) {
    super();
    this.storagePath = options.storagePath || path.resolve(process.cwd(), "data", "multidevice-state.json");
    this.logger = options.logger || null;
    this.masterSecret = options.masterSecret || process.env.ULTRON_DEVICE_SIGNING_SECRET || "";
    this.encryptionKey = null;
    if (this.masterSecret && this.masterSecret.length >= 32) {
      this.encryptionKey = crypto.createHash("sha256").update("ULTRON_MULTIDEVICE_PERSISTENCE:").update(this.masterSecret).digest();
    }
  }

  saveSync(data = {}) {
    let tmpPath = null;
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const serialized = {
        version: "2.0.0",
        savedAt: new Date().toISOString(),
        devices: Array.isArray(data.devices) ? data.devices : Array.from(data.devices?.entries?.() || []),
        sharedState: Array.isArray(data.sharedState) ? data.sharedState : Array.from(data.sharedState?.entries?.() || []),
        pendingDeliveries: Array.isArray(data.pendingDeliveries) ? data.pendingDeliveries : Array.from(data.pendingDeliveries?.entries?.() || []),
        revokedDevices: Array.isArray(data.revokedDevices) ? data.revokedDevices : Array.from(data.revokedDevices || [])
      };

      tmpPath = `${this.storagePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
      const content = encryptPayloadAtRest(serialized, this.encryptionKey);
      fs.writeFileSync(tmpPath, content, { encoding: "utf8", mode: 0o600 });
      fs.renameSync(tmpPath, this.storagePath);
      return true;
    } catch (err) {
      if (tmpPath) {
        try { fs.unlinkSync(tmpPath); } catch {}
      }
      if (this.logger?.error) {
        this.logger.error("FilePersistenceAdapter: failed to save to disk", { error: err?.message });
      }
      return false;
    }
  }

  loadSync() {
    try {
      if (!fs.existsSync(this.storagePath)) return null;
      const raw = fs.readFileSync(this.storagePath, "utf8");
      if (!raw || !raw.trim()) return null;
      return decryptPayloadAtRest(raw, this.encryptionKey, this.logger);
    } catch (err) {
      if (err.message === "ENCRYPTION_KEY_REQUIRED_FOR_PERSISTENCE" || err.message === "CORRUPTED_ENCRYPTED_PERSISTENCE_DATA") {
        throw err;
      }
      if (this.logger?.warn) {
        this.logger.warn("FilePersistenceAdapter: failed to read disk file", { error: err?.message });
      }
      return null;
    }
  }

  async save(data) {
    return this.saveSync(data);
  }

  async load() {
    return this.loadSync();
  }

  async saveSharedState(stateUpdate = {}) {
    const current = this.loadSync() || { devices: [], sharedState: [], pendingDeliveries: [], revokedDevices: [] };
    const sharedMap = new Map(current.sharedState || []);
    const existing = sharedMap.get(stateUpdate.stateKey);
    const currentVersion = existing ? (Number(existing.version) || 0) : 0;

    if (stateUpdate.expectedVersion !== null && stateUpdate.expectedVersion !== undefined) {
      if (Number(stateUpdate.expectedVersion) !== currentVersion) {
        return {
          success: false,
          error: "VERSION_CONFLICT",
          currentVersion,
          expectedVersion: Number(stateUpdate.expectedVersion)
        };
      }
    }

    const nextVersion = currentVersion + 1;
    sharedMap.set(stateUpdate.stateKey, {
      key: stateUpdate.stateKey,
      payload: stateUpdate.payload,
      originDeviceId: stateUpdate.originDeviceId || null,
      updatedAt: new Date().toISOString(),
      version: nextVersion
    });

    current.sharedState = Array.from(sharedMap.entries());
    const ok = this.saveSync(current);
    return { success: ok, version: nextVersion, backend: "file", cloudPersisted: false };
  }

  async acknowledgeDelivery(deviceId, deliveryId) {
    const current = this.loadSync();
    if (!current) return { success: false, error: "NO_PERSISTED_STATE" };
    const pendingMap = new Map(current.pendingDeliveries || []);
    const queue = pendingMap.get(deviceId) || [];
    const filtered = queue.filter(item => item.deliveryId !== deliveryId);
    pendingMap.set(deviceId, filtered);
    current.pendingDeliveries = Array.from(pendingMap.entries());
    const ok = this.saveSync(current);
    return { success: ok, backend: "file", cloudPersisted: false, remainingCount: filtered.length };
  }

  async revokeDevice(deviceId) {
    const current = this.loadSync() || { devices: [], sharedState: [], pendingDeliveries: [], revokedDevices: [] };
    const revokedSet = new Set(current.revokedDevices || []);
    revokedSet.add(deviceId);
    current.revokedDevices = Array.from(revokedSet);
    const pendingMap = new Map(current.pendingDeliveries || []);
    pendingMap.delete(deviceId);
    current.pendingDeliveries = Array.from(pendingMap.entries());
    const ok = this.saveSync(current);
    return { success: ok, backend: "file", cloudPersisted: false };
  }
}

/**
 * DatabasePersistenceAdapter — Durable database-backed persistence adapter.
 * Supports PostgreSQL via connection URL / client pool or Supabase REST.
 * Reuses long-lived connection pool with Render/Supabase SSL support.
 * Encrypts payloads at rest when masterSecret is configured.
 * Always maintains a FilePersistenceAdapter fallback for seamless fault tolerance.
 */
export class DatabasePersistenceAdapter extends BaseMultiDevicePersistenceAdapter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.databaseUrl = options.databaseUrl || process.env.ULTRON_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
    this.pgPool = options.pgPool || null;
    this._internalPool = null;
    this.supabaseRest = options.supabaseRest || null;
    this.fallbackAdapter = options.fallbackAdapter || new FilePersistenceAdapter(options);
    this.logger = options.logger || null;
    this.isOnline = true;
    this.inMemoryMockDb = options.inMemoryMockDb || null; // For zero-dependency testing
    this.masterSecret = options.masterSecret || process.env.ULTRON_DEVICE_SIGNING_SECRET || "";
    this.encryptionKey = null;
    if (this.masterSecret && this.masterSecret.length >= 32) {
      this.encryptionKey = crypto.createHash("sha256").update("ULTRON_MULTIDEVICE_PERSISTENCE:").update(this.masterSecret).digest();
    }
    this._cachedState = null;
    this.lastLoadOutcome = { backend: "not_loaded", authoritative: false, cloudPersisted: false };
    this.lastRootVersion = null;
  }

  resolvePoolConfig() {
    if (!this.databaseUrl) return null;

    let connectionUrl;
    try {
      connectionUrl = new URL(this.databaseUrl);
    } catch {
      throw new Error("INVALID_DATABASE_URL");
    }

    const hostname = connectionUrl.hostname.toLowerCase();
    const isLocal = hostname === "localhost"
      || hostname === "127.0.0.1"
      || hostname === "::1"
      || hostname.endsWith(".localhost");

    const poolConfig = {
      connectionString: this.databaseUrl,
      max: 4,
      connectionTimeoutMillis: 4000,
      idleTimeoutMillis: 30000
    };

    if (!isLocal) {
      // Remote database connections must always use TLS with certificate verification.
      // Strip libpq SSL mode parameters so the URL cannot silently override this policy.
      for (const parameter of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) {
        connectionUrl.searchParams.delete(parameter);
      }
      poolConfig.connectionString = connectionUrl.toString();

      const sslConfig = { rejectUnauthorized: true };
      const customCa = this.options.ssl?.ca
        || process.env.DATABASE_CA_CERT
        || process.env.PGSSLROOTCERT
        || process.env.SUPABASE_SSL_CA;
      if (customCa) sslConfig.ca = customCa;

      // Allow certificate material and protocol tuning, but never allow callers or
      // environment variables to disable peer verification.
      if (typeof this.options.ssl === "object" && this.options.ssl !== null) {
        for (const key of ["cert", "key", "minVersion", "maxVersion", "servername"]) {
          if (this.options.ssl[key] !== undefined) sslConfig[key] = this.options.ssl[key];
        }
      }
      poolConfig.ssl = sslConfig;
    }

    return poolConfig;
  }
  async getPool() {
    if (this.pgPool) return this.pgPool;
    if (this._internalPool) return this._internalPool;
    if (!this.databaseUrl) return null;
    const pg = await import("pg").catch(() => null);
    if (!pg || !pg.default?.Pool) return null;

    const poolConfig = this.resolvePoolConfig();
    this._internalPool = new pg.default.Pool(poolConfig);
    this._internalPool.on("error", (err) => {
      this.isOnline = false;
      if (this.logger?.warn) this.logger.warn("DatabasePersistenceAdapter: pool background error", { error: err?.message });
    });
    return this._internalPool;
  }

  async close() {
    if (this._internalPool) {
      await this._internalPool.end().catch(() => {});
      this._internalPool = null;
    }
  }

  saveSync(data) {
    // Synchronous call writes immediately to fallback file and updates in-memory cache
    this._cachedState = data;
    const fileResult = this.fallbackAdapter ? this.fallbackAdapter.saveSync(data) : false;
    // Asynchronously update database if reachable
    this.save(data).catch(() => {});
    return fileResult;
  }

  loadSync() {
    return this._cachedState || (this.fallbackAdapter ? this.fallbackAdapter.loadSync() : null);
  }

  async save(data = {}) {
    const serialized = {
      version: "2.0.0",
      savedAt: new Date().toISOString(),
      devices: Array.isArray(data.devices) ? data.devices : Array.from(data.devices?.entries?.() || []),
      sharedState: Array.isArray(data.sharedState) ? data.sharedState : Array.from(data.sharedState?.entries?.() || []),
      pendingDeliveries: Array.isArray(data.pendingDeliveries) ? data.pendingDeliveries : Array.from(data.pendingDeliveries?.entries?.() || []),
      revokedDevices: Array.isArray(data.revokedDevices) ? data.revokedDevices : Array.from(data.revokedDevices || [])
    };

    this._cachedState = serialized;

    // Keep a local recovery copy, but track its outcome separately from cloud durability.
    let fallbackPersisted = false;
    if (this.fallbackAdapter) {
      try {
        const fallbackResult = await this.fallbackAdapter.save(serialized);
        fallbackPersisted = fallbackResult === true || fallbackResult?.success === true;
      } catch {
        fallbackPersisted = false;
      }
    }

    // 1. In-memory mock database (used in unit test suites without external daemons)
    if (this.inMemoryMockDb) {
      this.inMemoryMockDb.set("multidevice_state", JSON.stringify(serialized));
      return { success: true, backend: "database", cloudPersisted: false, fallbackPersisted, note: "mock_pg_saved" };
    }

    // Encrypt at rest before storing in database if encryption key is configured
    let stateToPersist = serialized;
    if (this.encryptionKey) {
      const jsonContent = JSON.stringify(serialized);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", this.encryptionKey, iv);
      const encrypted = Buffer.concat([cipher.update(jsonContent, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      stateToPersist = {
        encrypted: true,
        algorithm: "aes-256-gcm",
        iv: iv.toString("hex"),
        tag: tag.toString("hex"),
        ciphertext: encrypted.toString("hex"),
        savedAt: serialized.savedAt
      };
    }

    // 2. PostgreSQL connection
    const pool = await this.getPool().catch(() => null);
    if (pool) {
      try {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["ultron_multidevice_state:root"]);
          await client.query(SQL_CREATE_STATE_TABLE);
          const currentRes = await client.query(SQL_SELECT_ROOT_VERSION_FOR_UPDATE);
          const currentVersion = currentRes.rows?.[0] ? Number(currentRes.rows[0].version) || 0 : 0;
          if (this.lastRootVersion !== null && currentVersion !== this.lastRootVersion) {
            await client.query("ROLLBACK");
            return {
              success: false, backend: "database", cloudPersisted: false,
              error: "ROOT_STATE_VERSION_CONFLICT", currentVersion, expectedVersion: this.lastRootVersion,
              fallbackPersisted
            };
          }
          const serializedJson = JSON.stringify(stateToPersist);
          await client.query(SQL_UPSERT_ROOT_STATE, [serializedJson]);
          await client.query("COMMIT");
          this.lastRootVersion = currentVersion + 1;
          this.isOnline = true;
          return { success: true, backend: "database", cloudPersisted: true, version: this.lastRootVersion };
        } catch (queryErr) {
          await client.query("ROLLBACK").catch(() => {});
          throw queryErr;
        } finally {
          client.release();
        }
      } catch (dbErr) {
        this.isOnline = false;
        if (this.logger?.warn) {
          this.logger.warn("DatabasePersistenceAdapter: Database write failed, used fallback", { error: dbErr?.message });
        }
        return {
          success: fallbackPersisted,
          backend: fallbackPersisted ? "fallback_file" : "unavailable",
          cloudPersisted: false,
          fallbackPersisted,
          warning: "DB_WRITE_FAILED_FALLBACK_USED",
          error: dbErr?.message
        };
      }
    }

    // 3. Supabase REST API
    if (this.supabaseRest && typeof this.supabaseRest.fetch === "function") {
      try {
        if (this.lastRootVersion === null) {
          const readResp = await this.supabaseRest.fetch("/rest/v1/ultron_multidevice_state?key=eq.root&select=version&limit=1", {
            method: "GET", headers: { "Accept": "application/json" }
          });
          if (!readResp.ok) {
            this.isOnline = false;
            return { success: fallbackPersisted, backend: fallbackPersisted ? "fallback_file" : "unavailable", cloudPersisted: false, fallbackPersisted, warning: "SUPABASE_REST_READ_FAILED", status: readResp.status };
          }
          const rows = await readResp.json();
          this.lastRootVersion = Array.isArray(rows) && rows[0] ? Number(rows[0].version) || 0 : 0;
        }
        const expectedVersion = this.lastRootVersion;
        const resp = await this.supabaseRest.fetch("/rest/v1/rpc/save_ultron_multidevice_state", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Prefer": "return=representation" },
          body: JSON.stringify({ p_key: "root", p_value: stateToPersist, p_expected_version: expectedVersion })
        });
        if (resp.ok) {
          const rows = await resp.json();
          const result = Array.isArray(rows) ? rows[0] : rows;
          if (!result?.success) {
            this.isOnline = true;
            return { success: false, backend: "supabase_rest", cloudPersisted: false, error: result?.error_code || "ROOT_STATE_VERSION_CONFLICT", currentVersion: Number(result?.version) || 0, expectedVersion };
          }
          this.lastRootVersion = Number(result.version);
          this.isOnline = true;
          return { success: true, backend: "supabase_rest", cloudPersisted: true, version: this.lastRootVersion };
        }
        this.isOnline = false;
        if (this.logger?.warn) {
          this.logger.warn("DatabasePersistenceAdapter: Supabase REST atomic state write returned a non-success status", { status: resp.status });
        }
        return {
          success: fallbackPersisted,
          backend: fallbackPersisted ? "fallback_file" : "unavailable",
          cloudPersisted: false,
          fallbackPersisted,
          warning: "SUPABASE_REST_WRITE_FAILED",
          status: resp.status
        };
      } catch (restErr) {
        this.isOnline = false;
        return {
          success: fallbackPersisted,
          backend: fallbackPersisted ? "fallback_file" : "unavailable",
          cloudPersisted: false,
          fallbackPersisted,
          warning: "SUPABASE_REST_WRITE_FAILED",
          error: restErr?.message
        };
      }
    }

    // Default: local fallback only; this is not cloud durability.
    return {
      success: fallbackPersisted,
      backend: fallbackPersisted ? "fallback_file" : "unavailable",
      cloudPersisted: false,
      fallbackPersisted,
      note: "no_db_configured"
    };
  }

  async load() {
    const emptySnapshot = () => ({
      version: "2.0.0",
      savedAt: new Date().toISOString(),
      devices: [],
      sharedState: [],
      pendingDeliveries: [],
      revokedDevices: []
    });

    // 1. In-memory mock database used only by isolated test suites.
    if (this.inMemoryMockDb) {
      const raw = this.inMemoryMockDb.get("multidevice_state");
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          this._cachedState = parsed;
          this.lastLoadOutcome = { backend: "database", authoritative: true, cloudPersisted: false, mock: true };
          return parsed;
        } catch {}
      }
      this._cachedState = emptySnapshot();
      this.lastLoadOutcome = { backend: "database", authoritative: true, cloudPersisted: false, mock: true };
      return this._cachedState;
    }

    // 2. PostgreSQL. A successful empty query is authoritative: do not resurrect
    // stale device queues from a local fallback when the cloud has no root row.
    const pool = await this.getPool().catch(() => null);
    if (pool) {
      try {
        const res = await pool.query(SQL_SELECT_ROOT_STATE);
        let loaded;
        this.lastRootVersion = res.rows?.[0] ? Number(res.rows[0].version) || 0 : 0;
        if (res.rows?.[0]?.value) {
          const val = res.rows[0].value;
          const parsedVal = typeof val === "string" ? JSON.parse(val) : val;
          loaded = this._decryptState(parsedVal);
        } else {
          loaded = emptySnapshot();
        }
        this._cachedState = loaded;
        this.lastLoadOutcome = { backend: "database", authoritative: true, cloudPersisted: true };
        if (this.fallbackAdapter) {
          try { await this.fallbackAdapter.save(loaded); } catch {}
        }
        this.isOnline = true;
        return loaded;
      } catch (err) {
        this.isOnline = false;
        if (this.logger?.warn) {
          this.logger.warn("DatabasePersistenceAdapter: Database read failed, trying another configured backend", { error: err?.message });
        }
      }
    }

    // 3. Supabase REST. A successful empty result means the cloud state is
    // currently empty; a failed request remains non-authoritative.
    if (this.supabaseRest && typeof this.supabaseRest.fetch === "function") {
      try {
        const resp = await this.supabaseRest.fetch("/rest/v1/ultron_multidevice_state?key=eq.root&limit=1", {
          method: "GET",
          headers: { "Accept": "application/json" }
        });
        if (resp.ok) {
          const rows = await resp.json();
          this.lastRootVersion = Array.isArray(rows) && rows[0] ? Number(rows[0].version) || 0 : 0;
          let loaded;
          if (Array.isArray(rows) && rows[0]?.value) {
            const val = rows[0].value;
            const parsedVal = typeof val === "string" ? JSON.parse(val) : val;
            loaded = this._decryptState(parsedVal);
          } else {
            loaded = emptySnapshot();
          }
          this._cachedState = loaded;
          this.lastLoadOutcome = { backend: "supabase_rest", authoritative: true, cloudPersisted: true };
          if (this.fallbackAdapter) {
            try { await this.fallbackAdapter.save(loaded); } catch {}
          }
          this.isOnline = true;
          return loaded;
        }

        this.isOnline = false;
        if (this.logger?.warn) {
          this.logger.warn("DatabasePersistenceAdapter: Supabase REST read returned a non-success status", { status: resp.status });
        }
      } catch (restErr) {
        this.isOnline = false;
        if (this.logger?.warn) {
          this.logger.warn("DatabasePersistenceAdapter: Supabase REST read failed", { error: restErr?.message });
        }
      }
    }

    // 4. Local fallback is useful for recovery, but is never cloud authority.
    if (this.fallbackAdapter) {
      const fileData = await this.fallbackAdapter.load();
      if (fileData) this._cachedState = fileData;
      this.lastLoadOutcome = { backend: "fallback_file", authoritative: false, cloudPersisted: false };
      return fileData;
    }
    this.lastLoadOutcome = { backend: "unavailable", authoritative: false, cloudPersisted: false };
    return this._cachedState;
  }

  _decryptState(val) {
    if (!val || typeof val !== "object") return val;
    if (val.encrypted === true && val.ciphertext && val.iv && val.tag) {
      if (!this.encryptionKey) {
        if (this.logger?.error) this.logger.error("DatabasePersistenceAdapter: encrypted database state found but no encryption key is configured");
        throw new Error("ENCRYPTION_KEY_REQUIRED_FOR_DATABASE_PERSISTENCE");
      }
      const iv = Buffer.from(val.iv, "hex");
      const tag = Buffer.from(val.tag, "hex");
      const ciphertext = Buffer.from(val.ciphertext, "hex");
      const decipher = crypto.createDecipheriv("aes-256-gcm", this.encryptionKey, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return JSON.parse(decrypted.toString("utf8"));
    }
    return val;
  }

  async saveSharedState(stateUpdate = {}) {
    const { stateKey, payload, originDeviceId, expectedVersion } = stateUpdate;
    if (!stateKey) return { success: false, error: "STATE_KEY_REQUIRED" };

    const stateRowKey = "state:" + String(stateKey);

    // Transactional version check in mock or database
    if (this.inMemoryMockDb) {
      const existingRaw = this.inMemoryMockDb.get(stateRowKey);
      let currentVersion = 0;
      if (existingRaw) {
        try {
          const parsed = JSON.parse(existingRaw);
          currentVersion = Number(parsed.version) || 0;
        } catch {}
      }

      if (expectedVersion !== null && expectedVersion !== undefined) {
        if (Number(expectedVersion) !== currentVersion) {
          return {
            success: false,
            error: "VERSION_CONFLICT",
            currentVersion,
            expectedVersion: Number(expectedVersion)
          };
        }
      }

      const nextVersion = currentVersion + 1;
      const stateObj = {
        key: stateKey,
        payload,
        originDeviceId: originDeviceId || null,
        version: nextVersion,
        updatedAt: new Date().toISOString()
      };
      this.inMemoryMockDb.set(stateRowKey, JSON.stringify(stateObj));
      return { success: true, version: nextVersion, backend: "database", cloudPersisted: false };
    }

    // PostgreSQL branch
    const pool = await this.getPool().catch(() => null);
    if (pool) {
      try {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["ultron_multidevice_state:" + stateRowKey]);
          const selRes = await client.query(SQL_SELECT_STATE_FOR_UPDATE, [stateRowKey]);
          const currentVersion = selRes.rows?.[0] ? Number(selRes.rows[0].version) : 0;

          if (expectedVersion !== null && expectedVersion !== undefined) {
            if (Number(expectedVersion) !== currentVersion) {
              await client.query("ROLLBACK");
              return {
                success: false,
                error: "VERSION_CONFLICT",
                currentVersion,
                expectedVersion: Number(expectedVersion)
              };
            }
          }

          const nextVersion = currentVersion + 1;
          const statePayloadJson = JSON.stringify({ payload, originDeviceId, version: nextVersion });
          await client.query(SQL_UPSERT_NAMED_STATE, [stateRowKey, statePayloadJson, nextVersion]);
          await client.query("COMMIT");
          return { success: true, version: nextVersion, backend: "database", cloudPersisted: true };
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      } catch (dbErr) {
        this.isOnline = false;
        if (this.fallbackAdapter) {
          const fallback = await this.fallbackAdapter.saveSharedState(stateUpdate);
          return {
            ...fallback,
            cloudPersisted: false,
            warning: "DATABASE_WRITE_FAILED",
            error: dbErr?.message
          };
        }
        return { success: false, backend: "unavailable", cloudPersisted: false, error: "DATABASE_UNAVAILABLE", details: dbErr?.message };
      }
    }

    // Supabase REST uses one transactional RPC so version checks cannot race between GET and POST.
    if (this.supabaseRest && typeof this.supabaseRest.fetch === "function") {
      try {
        const response = await this.supabaseRest.fetch("/rest/v1/rpc/save_ultron_multidevice_state", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Prefer": "return=representation" },
          body: JSON.stringify({
            p_key: stateRowKey,
            p_value: { payload, originDeviceId: originDeviceId || null },
            p_expected_version: expectedVersion === undefined ? null : expectedVersion
          })
        });
        if (!response.ok) {
          this.isOnline = false;
          const fallback = this.fallbackAdapter
            ? await this.fallbackAdapter.saveSharedState(stateUpdate)
            : { success: false, error: "SUPABASE_REST_WRITE_FAILED" };
          return { ...fallback, cloudPersisted: false, warning: "SUPABASE_REST_WRITE_FAILED", status: response.status };
        }
        const rows = await response.json();
        const result = Array.isArray(rows) ? rows[0] : rows;
        if (!result?.success) {
          return {
            success: false, error: result?.error_code || "VERSION_CONFLICT",
            currentVersion: Number(result?.version) || 0,
            expectedVersion: expectedVersion === undefined ? null : expectedVersion,
            backend: "supabase_rest", cloudPersisted: false
          };
        }
        this.isOnline = true;
        return { success: true, version: Number(result.version), backend: "supabase_rest", cloudPersisted: true };
      } catch (restErr) {
        this.isOnline = false;
        const fallback = this.fallbackAdapter
          ? await this.fallbackAdapter.saveSharedState(stateUpdate)
          : { success: false, error: "SUPABASE_REST_WRITE_FAILED" };
        return { ...fallback, cloudPersisted: false, warning: "SUPABASE_REST_WRITE_FAILED", error: restErr?.message };
      }
    }
    // Fallback to file adapter
    if (this.fallbackAdapter) {
      return await this.fallbackAdapter.saveSharedState(stateUpdate);
    }
    return { success: false, error: "NO_PERSISTENCE_BACKEND" };
  }

  async acknowledgeDelivery(deviceId, deliveryId) {
    if (this.inMemoryMockDb) {
      const qKey = "queue:" + String(deviceId);
      const raw = this.inMemoryMockDb.get(qKey);
      let queue = [];
      if (raw) {
        try { queue = JSON.parse(raw); } catch {}
      }
      const filtered = queue.filter(item => item.deliveryId !== deliveryId);
      this.inMemoryMockDb.set(qKey, JSON.stringify(filtered));
      return { success: true, backend: "database", cloudPersisted: false, remainingCount: filtered.length };
    }

    const current = await this.load();
    if (!current) return { success: false, error: "NO_PERSISTED_STATE" };
    const pendingMap = new Map(current.pendingDeliveries || []);
    const queue = pendingMap.get(deviceId) || [];
    const filtered = queue.filter(item => item.deliveryId !== deliveryId);
    if (filtered.length === queue.length) {
      return { success: false, error: "DELIVERY_NOT_FOUND", remainingCount: queue.length };
    }
    pendingMap.set(deviceId, filtered);
    current.pendingDeliveries = Array.from(pendingMap.entries());
    const persisted = await this.save(current);
    return {
      success: persisted.success === true,
      backend: persisted.backend,
      cloudPersisted: persisted.cloudPersisted,
      remainingCount: filtered.length,
      ...(persisted.warning ? { warning: persisted.warning } : {})
    };
  }

  async revokeDevice(deviceId) {
    if (this.inMemoryMockDb) {
      this.inMemoryMockDb.set("revoked:" + String(deviceId), "true");
      this.inMemoryMockDb.delete("queue:" + String(deviceId));
    }

    const current = await this.load() || { devices: [], sharedState: [], pendingDeliveries: [], revokedDevices: [] };
    const revokedSet = new Set(current.revokedDevices || []);
    revokedSet.add(deviceId);
    current.revokedDevices = Array.from(revokedSet);
    const pendingMap = new Map(current.pendingDeliveries || []);
    pendingMap.delete(deviceId);
    current.pendingDeliveries = Array.from(pendingMap.entries());
    const persisted = await this.save(current);
    return {
      success: persisted.success === true,
      backend: persisted.backend,
      cloudPersisted: persisted.cloudPersisted,
      ...(persisted.warning ? { warning: persisted.warning } : {})
    };
  }
}

/**
 * Factory helper to construct the appropriate persistence adapter.
 */
export function createMultiDevicePersistenceAdapter(options = {}) {
  if (options.persistenceAdapter) return options.persistenceAdapter;

  const dbUrl = options.databaseUrl || process.env.ULTRON_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const supabaseUrl = options.supabaseUrl || process.env.SUPABASE_URL;
  const serviceRoleKey = options.supabaseServiceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  let supabaseRest = options.supabaseRest || null;
  if (!supabaseRest && supabaseUrl && serviceRoleKey && typeof fetchImpl === "function") {
    const baseUrl = new URL(supabaseUrl);
    const isLoopback = baseUrl.hostname === "localhost" || baseUrl.hostname === "127.0.0.1" || baseUrl.hostname === "::1";
    if (baseUrl.protocol !== "https:" && !(baseUrl.protocol === "http:" && isLoopback)) {
      throw new Error("SUPABASE_URL_MUST_USE_HTTPS");
    }
    baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, "");

    supabaseRest = {
      fetch: (requestPath, init = {}) => {
        if (typeof requestPath !== "string" || !requestPath.startsWith("/rest/v1/")) {
          throw new Error("SUPABASE_REST_PATH_NOT_ALLOWED");
        }
        const target = new URL(requestPath, baseUrl);
        if (target.origin !== baseUrl.origin || !target.pathname.startsWith("/rest/v1/")) {
          throw new Error("SUPABASE_REST_TARGET_NOT_ALLOWED");
        }
        const headers = new Headers(init.headers || {});
        headers.set("apikey", serviceRoleKey);
        if (serviceRoleKey.startsWith("eyJ")) {
          headers.set("Authorization", "Bearer " + serviceRoleKey);
        } else {
          // New sb_secret_* keys are API keys, not JWTs; do not send them as Bearer tokens.
          headers.delete("Authorization");
        }
        return fetchImpl(target.toString(), { ...init, headers });
      }
    };
  }

  const fallback = new FilePersistenceAdapter(options);
  if (dbUrl || supabaseRest || options.inMemoryMockDb) {
    return new DatabasePersistenceAdapter({
      ...options,
      databaseUrl: dbUrl,
      supabaseRest,
      fallbackAdapter: fallback
    });
  }
  return fallback;
}
