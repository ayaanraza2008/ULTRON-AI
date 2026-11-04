/**
 * ULTRON AI — Multi-Device Network Discovery & Connectivity Manager
 * 
 * Manages Dual-Mode Device Connectivity:
 * 1. LOCAL MODE (Same-Wi-Fi):
 *    - Discovers local instances without internet access.
 *    - Enumerates LAN network interfaces (192.168.x.x, 10.x.x.x, 172.16-31.x.x).
 *    - Generates local instance beacon metadata.
 * 
 * 2. REMOTE MODE (Tailscale & Authenticated Cloud Relay):
 *    - Detects Tailscale private networking (Carrier-Grade NAT 100.64.0.0/10).
 *    - Enables zero-public-port Windows connectivity (outbound WebSocket/long-poll).
 *    - Provides connectivity status probe and network transition recovery.
 */

import os from "node:os";

export class DeviceNetworkingManager {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.defaultPort = Number(this.env.PORT) || 10000;
  }

  /**
   * Scans local network interfaces and returns reachable LAN addresses.
   */
  getLocalInterfaces() {
    const interfaces = os.networkInterfaces();
    const localIps = [];

    for (const [name, addrs] of Object.entries(interfaces)) {
      if (!Array.isArray(addrs)) continue;
      for (const addr of addrs) {
        if (addr.internal) continue; // Skip loopback 127.0.0.1
        if (addr.family === "IPv4") {
          const ip = addr.address;
          // Standard private network ranges
          const isPrivate =
            ip.startsWith("192.168.") ||
            ip.startsWith("10.") ||
            /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip);

          if (isPrivate) {
            localIps.push({
              interface: name,
              ip,
              type: "local_lan"
            });
          }
        }
      }
    }

    return localIps;
  }

  /**
   * Probes for Tailscale private network presence.
   * Tailscale assigns IP addresses in the 100.64.0.0/10 CGNAT range.
   */
  getTailscaleStatus() {
    const fromEnv = this.env.TAILSCALE_IP || this.env.ULTRON_TAILSCALE_IP;
    if (fromEnv && /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./.test(fromEnv.trim())) {
      return {
        active: true,
        tailscaleIp: fromEnv.trim(),
        source: "environment"
      };
    }

    const interfaces = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(interfaces)) {
      if (!Array.isArray(addrs)) continue;
      const lowerName = name.toLowerCase();
      const isTailscaleInterface = lowerName.includes("tailscale") || lowerName.includes("utun") || lowerName.includes("tun");

      for (const addr of addrs) {
        if (addr.family === "IPv4") {
          const ip = addr.address;
          // Check 100.64.0.0/10
          if (/^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./.test(ip)) {
            return {
              active: true,
              interface: name,
              tailscaleIp: ip,
              source: "interface_detected"
            };
          }
        }
      }
    }

    return {
      active: false,
      tailscaleIp: null,
      source: "not_detected"
    };
  }

  /**
   * Generates local discovery beacon data for same-Wi-Fi companion apps.
   */
  getLocalDiscoveryBeacon(port = null) {
    const currentPort = port || this.defaultPort;
    const localInterfaces = this.getLocalInterfaces();
    const tailscale = this.getTailscaleStatus();
    const primaryIp = localInterfaces[0]?.ip || "127.0.0.1";

    return {
      service: "ULTRON-AI-CORE",
      version: "2.0.0",
      hostname: os.hostname(),
      platform: process.platform,
      localPort: currentPort,
      primaryLocalUrl: `http://${primaryIp}:${currentPort}`,
      localInterfaces,
      tailscale,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Reports complete multi-device connectivity diagnostics.
   */
  getConnectivityStatus(port = null) {
    const beacon = this.getLocalDiscoveryBeacon(port);
    const cloudUrl = this.env.ULTRON_BACKEND_URL || "https://ultron-ai-core.onrender.com";

    return {
      modes: {
        local: {
          supported: true,
          active: beacon.localInterfaces.length > 0,
          primaryEndpoint: beacon.primaryLocalUrl,
          interfaces: beacon.localInterfaces
        },
        tailscale: {
          supported: true,
          active: beacon.tailscale.active,
          tailscaleIp: beacon.tailscale.tailscaleIp
        },
        cloudRelay: {
          supported: true,
          active: Boolean(cloudUrl),
          endpoint: cloudUrl,
          outboundOnlyWindows: true
        }
      },
      recommendedMode: beacon.localInterfaces.length > 0 ? "LOCAL_WIFI" : beacon.tailscale.active ? "TAILSCALE" : "CLOUD_RELAY",
      timestamp: new Date().toISOString()
    };
  }
}

export const deviceNetworkingManager = new DeviceNetworkingManager();
