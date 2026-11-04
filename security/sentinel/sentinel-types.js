/**
 * ULTRON AI — Sentinel Cybersecurity Division
 * Module: SENTINEL TYPES & CONSTANTS (security/sentinel/sentinel-types.js)
 *
 * Defines the operational phases, risk scoring tiers, scan lifecycle states,
 * device classifications, and defensive policy boundaries adapted from Nightcrawler.
 */

export const SENTINEL_PHASES = Object.freeze({
  DISCOVER: "DISCOVER",
  INVENTORY: "INVENTORY",
  ANALYZE: "ANALYZE",
  IDENTIFY_RISKS: "IDENTIFY_RISKS",
  PRIORITIZE: "PRIORITIZE",
  RECOMMEND: "RECOMMEND",
  REPORT: "REPORT"
});

export const SCAN_STATUS = Object.freeze({
  IDLE: "IDLE",
  INITIALIZING: "INITIALIZING",
  RUNNING: "RUNNING",
  PAUSED: "PAUSED",
  STOPPED: "STOPPED",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED"
});

export const RISK_SEVERITY = Object.freeze({
  CRITICAL: "CRITICAL",   // CVSS 9.0 - 10.0
  HIGH: "HIGH",           // CVSS 7.0 - 8.9
  MEDIUM: "MEDIUM",       // CVSS 4.0 - 6.9
  LOW: "LOW",             // CVSS 0.1 - 3.9
  INFORMATIONAL: "INFORMATIONAL" // CVSS 0.0
});

export const DEVICE_TYPES = Object.freeze({
  GATEWAY: "GATEWAY",
  SERVER: "SERVER",
  WORKSTATION: "WORKSTATION",
  MOBILE: "MOBILE",
  CONTAINER: "CONTAINER",
  IOT: "IOT",
  UNKNOWN: "UNKNOWN"
});

export const SENTINEL_EVENTS = Object.freeze({
  SCAN_STARTED: "SCAN_STARTED",
  PHASE_TRANSITION: "PHASE_TRANSITION",
  ASSET_DISCOVERED: "ASSET_DISCOVERED",
  PORT_IDENTIFIED: "PORT_IDENTIFIED",
  SERVICE_FINGERPRINTED: "SERVICE_FINGERPRINTED",
  VULNERABILITY_DETECTED: "VULNERABILITY_DETECTED",
  RISK_PRIORITIZED: "RISK_PRIORITIZED",
  SCAN_PAUSED: "SCAN_PAUSED",
  SCAN_RESUMED: "SCAN_RESUMED",
  SCAN_STOPPED: "SCAN_STOPPED",
  SCAN_COMPLETED: "SCAN_COMPLETED",
  EMERGENCY_HALT: "EMERGENCY_HALT",
  SCOPE_BLOCKED: "SCOPE_BLOCKED"
});

/**
 * Standard safe ports inspected during defensive inventory.
 * Strictly non-intrusive safe TCP connect checks only.
 */
export const DEFAULT_SAFE_PORTS = Object.freeze([
  { port: 21, service: "ftp", protocol: "tcp", description: "File Transfer Protocol (Cleartext)" },
  { port: 22, service: "ssh", protocol: "tcp", description: "Secure Shell" },
  { port: 23, service: "telnet", protocol: "tcp", description: "Telnet (Insecure Cleartext)" },
  { port: 25, service: "smtp", protocol: "tcp", description: "Simple Mail Transfer Protocol" },
  { port: 53, service: "dns", protocol: "tcp", description: "Domain Name System" },
  { port: 80, service: "http", protocol: "tcp", description: "HyperText Transfer Protocol (Cleartext)" },
  { port: 110, service: "pop3", protocol: "tcp", description: "Post Office Protocol v3" },
  { port: 139, service: "netbios-ssn", protocol: "tcp", description: "NetBIOS Session Service" },
  { port: 143, service: "imap", protocol: "tcp", description: "Internet Message Access Protocol" },
  { port: 443, service: "https", protocol: "tcp", description: "HTTP Secure (TLS/SSL)" },
  { port: 445, service: "smb", protocol: "tcp", description: "Microsoft-DS SMB" },
  { port: 1433, service: "mssql", protocol: "tcp", description: "Microsoft SQL Server" },
  { port: 1521, service: "oracle", protocol: "tcp", description: "Oracle Database" },
  { port: 2375, service: "docker", protocol: "tcp", description: "Docker REST API (Unencrypted)" },
  { port: 2376, service: "docker-tls", protocol: "tcp", description: "Docker REST API (TLS)" },
  { port: 3000, service: "node-http", protocol: "tcp", description: "Development HTTP / Node.js" },
  { port: 3306, service: "mysql", protocol: "tcp", description: "MySQL / MariaDB" },
  { port: 3389, service: "rdp", protocol: "tcp", description: "Remote Desktop Protocol" },
  { port: 5432, service: "postgresql", protocol: "tcp", description: "PostgreSQL Database" },
  { port: 6379, service: "redis", protocol: "tcp", description: "Redis In-Memory Key-Value" },
  { port: 8080, service: "http-alt", protocol: "tcp", description: "Alternative HTTP / Proxy" },
  { port: 8443, service: "https-alt", protocol: "tcp", description: "Alternative HTTPS" },
  { port: 9200, service: "elasticsearch", protocol: "tcp", description: "Elasticsearch REST API" },
  { port: 27017, service: "mongodb", protocol: "tcp", description: "MongoDB Database" }
]);
