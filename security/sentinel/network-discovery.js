/**
 * ULTRON AI — Sentinel Cybersecurity Division
 * Module: NETWORK DISCOVERY & TOPOLOGY ENGINE (security/sentinel/network-discovery.js)
 *
 * Implements safe, strictly authorized, read-only network discovery,
 * TCP connect port enumeration, service banner fingerprinting, and
 * network topology graph generation.
 *
 * STRICT DEFENSIVE POLICY:
 * - 100% fail-closed authorization via TargetAuthorizationGateway
 * - Zero offensive exploitation, zero brute-force attempts
 * - Strict connect timeouts and rate limiting
 */

import net from "node:net";
import dns from "node:dns/promises";
import { targetAuthorizationGateway, PERMITTED_ACTIVITIES } from "../target-authorization-gateway.js";
import { DEFAULT_SAFE_PORTS, DEVICE_TYPES } from "./sentinel-types.js";
import { parseServiceBanner } from "./cve-database.js";

export class NetworkDiscoveryEngine {
  constructor(options = {}) {
    this.authGateway = options.authGateway || targetAuthorizationGateway;
    this.defaultTimeoutMs = options.defaultTimeoutMs || 1500;
    this.rateLimitMs = options.rateLimitMs || 100; // 100ms pause between probes (max 10 probes/sec)
  }

  /**
   * Safely probes a single port on a target using standard non-intrusive TCP connect.
   * Reads banner if emitted by service (up to 512 bytes) and immediately disconnects.
   */
  async probeTcpPort(host, port, timeoutMs = this.defaultTimeoutMs) {
    return new Promise(resolve => {
      const socket = new net.Socket();
      let isResolved = false;
      let banner = "";

      const cleanup = () => {
        if (!socket.destroyed) {
          socket.destroy();
        }
      };

      socket.setTimeout(timeoutMs);

      socket.once("connect", () => {
        // Send safe HTTP probe if port 80/8080/3000 to elicit standard server header
        if ([80, 8080, 3000].includes(port)) {
          socket.write(`HEAD / HTTP/1.0\r\nHost: ${host}\r\nUser-Agent: Ultron-Sentinel/1.0\r\n\r\n`);
        }
      });

      socket.on("data", chunk => {
        banner += chunk.toString("utf8");
        if (banner.length > 512 || !isResolved) {
          isResolved = true;
          cleanup();
          resolve({ open: true, port, banner: banner.slice(0, 512).trim() });
        }
      });

      socket.once("timeout", () => {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          // If connected before timeout without data, it's still open
          resolve({ open: false, port, banner: null, reason: "TIMEOUT" });
        }
      });

      socket.once("error", err => {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          resolve({ open: false, port, banner: null, reason: err.code || "REFUSED" });
        }
      });

      // If connected and no data arrives within small window, resolve as open
      socket.once("ready", () => {
        setTimeout(() => {
          if (!isResolved) {
            isResolved = true;
            cleanup();
            resolve({ open: true, port, banner: banner.slice(0, 512).trim() });
          }
        }, Math.min(timeoutMs, 500));
      });

      socket.connect(port, host);
    });
  }

  /**
   * Safe discovery scan on an authorized host.
   */
  async scanHost(targetHost, options = {}) {
    const cleanHost = String(targetHost || "").trim().toLowerCase();
    if (!cleanHost) throw new Error("Host discovery failed: Target host is required.");

    // Mandatory authorization assertion
    this.authGateway.assertAuthorization(cleanHost, PERMITTED_ACTIVITIES.NETWORK_DEFENSE_AUDIT);

    const portsToScan = options.ports && Array.isArray(options.ports) && options.ports.length > 0
      ? options.ports
      : DEFAULT_SAFE_PORTS.map(p => p.port);

    const openPorts = [];
    let hostname = cleanHost;

    // Safe reverse DNS lookup
    try {
      const reversed = await dns.reverse(cleanHost);
      if (reversed && reversed.length > 0) hostname = reversed[0];
    } catch {
      // Retain cleanHost if reverse DNS lookup does not resolve
    }

    // Rate-limited serial/batched port probes
    for (const port of portsToScan) {
      if (this.authGateway.emergencyStopEngaged) {
        throw new Error("Discovery scan aborted: Emergency Stop engaged.");
      }

      const probeResult = await this.probeTcpPort(cleanHost, port, options.timeoutMs || this.defaultTimeoutMs);
      if (probeResult.open) {
        const portMeta = DEFAULT_SAFE_PORTS.find(p => p.port === port) || {
          port,
          service: "unknown",
          protocol: "tcp",
          description: "TCP Service"
        };

        const bannerInfo = parseServiceBanner(probeResult.banner);

        openPorts.push({
          port,
          protocol: "tcp",
          service: bannerInfo.name !== "unknown" ? bannerInfo.name : portMeta.service,
          detectedVersion: bannerInfo.version || null,
          banner: probeResult.banner || null,
          description: portMeta.description
        });
      }

      // Safe rate-limiting delay between probes
      if (this.rateLimitMs > 0) {
        await new Promise(r => setTimeout(r, this.rateLimitMs));
      }
    }

    // Infer node device classification
    const deviceType = this._classifyDeviceType(cleanHost, openPorts);

    return {
      ip: cleanHost,
      hostname,
      deviceType,
      openPorts,
      portsScannedCount: portsToScan.length,
      scannedAt: new Date().toISOString()
    };
  }

  /**
   * Classify device role based on discovered ports & IP heuristics.
   */
  _classifyDeviceType(host, openPorts = []) {
    const ports = openPorts.map(p => p.port);
    if (host === "127.0.0.1" || host === "localhost" || host === "::1") {
      return DEVICE_TYPES.WORKSTATION;
    }
    if (host.endsWith(".1") || host.endsWith(".254")) {
      return DEVICE_TYPES.GATEWAY;
    }
    if (ports.includes(2375) || ports.includes(2376)) {
      return DEVICE_TYPES.CONTAINER;
    }
    if (ports.includes(80) || ports.includes(443) || ports.includes(5432) || ports.includes(3306) || ports.includes(6379)) {
      return DEVICE_TYPES.SERVER;
    }
    return DEVICE_TYPES.WORKSTATION;
  }

  /**
   * Generates a network topology graph from a collection of scanned assets.
   */
  buildTopology(assets = []) {
    const nodes = [];
    const edges = [];
    const subnets = new Set();

    // Add default gateway node
    const gatewayNode = {
      id: "node-gateway",
      label: "Default Gateway",
      type: DEVICE_TYPES.GATEWAY,
      ip: "192.168.1.1",
      status: "ONLINE"
    };
    nodes.push(gatewayNode);

    assets.forEach((asset, idx) => {
      const assetId = `node-asset-${idx}-${asset.ip.replace(/[^a-zA-Z0-9]/g, "_")}`;
      nodes.push({
        id: assetId,
        label: asset.hostname || asset.ip,
        ip: asset.ip,
        type: asset.deviceType || DEVICE_TYPES.WORKSTATION,
        openPortCount: asset.openPorts?.length || 0,
        status: "ACTIVE",
        services: (asset.openPorts || []).map(p => `${p.service}:${p.port}`)
      });

      // Edge from gateway to asset
      edges.push({
        from: gatewayNode.id,
        to: assetId,
        protocol: "IP/ARP",
        state: "CONNECTED"
      });

      // Service child nodes for visual breakdown
      (asset.openPorts || []).forEach(p => {
        const serviceNodeId = `svc-${assetId}-${p.port}`;
        nodes.push({
          id: serviceNodeId,
          label: `${p.service.toUpperCase()} (${p.port})`,
          type: "SERVICE",
          port: p.port,
          service: p.service,
          status: "LISTENING"
        });
        edges.push({
          from: assetId,
          to: serviceNodeId,
          protocol: p.protocol || "tcp",
          state: "LISTENING"
        });
      });

      // Extract subnet (assuming standard /24 for IPv4)
      const ipParts = asset.ip.split(".");
      if (ipParts.length === 4) {
        subnets.add(`${ipParts[0]}.${ipParts[1]}.${ipParts[2]}.0/24`);
      } else {
        subnets.add("local/loopback");
      }
    });

    return {
      nodes,
      edges,
      subnets: Array.from(subnets),
      assetCount: assets.length,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      generatedAt: new Date().toISOString()
    };
  }
}

export const networkDiscoveryEngine = new NetworkDiscoveryEngine();
