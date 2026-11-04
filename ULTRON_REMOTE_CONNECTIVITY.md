# ULTRON AI — Remote & Local Connectivity Architecture
## SAME-WI-FI LOCAL MODE · TAILSCALE PRIVATE MESH · CLOUD RELAY

---

## 1. Dual-Mode Connectivity Strategy

To ensure seamless operation whether the user is sitting at their desk or traveling thousands of miles away, ULTRON supports two distinct networking modes:

```
                      +-----------------------------+
                      |   AUTHENTICATION CHECKPOINT |
                      |    (Cryptographic Tokens)   |
                      +--------------+--------------+
                                     |
               +---------------------+---------------------+
               |                                           |
               ▼                                           ▼
      [LOCAL WI-FI MODE]                          [REMOTE MODE]
   - Sub-5ms direct latency                   - Anywhere in the world
   - LAN IP Auto-Discovery                   - Tailscale 100.x.y.z Mesh
   - Direct HTTP / WS endpoint                - Outbound-Only Windows Node
   - Offline router survivable                - Encrypted Cloud Brain Relay
```

---

## 2. Mode 1: Local Mode (Same-Wi-Fi)

- **Purpose**: Low-latency, zero-cloud communication when phone and PC are connected to the same home or office network.
- **Discovery Mechanism**:
  - The central engine exposes `GET /api/discovery/local` advertising reachable LAN IP addresses (e.g. `192.168.1.x`, `10.0.0.x`).
  - Companion apps probe known subnet addresses or use discovery beacons to connect directly to the local port (e.g. `http://192.168.1.50:10000`).
- **Resilience**: Even if public internet access is down, local voice control and Windows PC commands continue to function.

---

## 3. Mode 2: Remote Mode (Tailscale & Cloud Relay)

- **Purpose**: Secure remote control from mobile networks (5G/LTE) or public Wi-Fi.
- **Zero Inbound Port Exposure on Windows**:
  - Exposing Windows desktop automation ports (such as RDP or raw HTTP control ports) to the public internet is a major security hazard.
  - ULTRON enforces **outbound-only connection** for the Windows companion.
  - The Windows PC connects OUTBOUND via TLS / WebSocket to the central brain.
- **Tailscale Mesh Compatibility**:
  - Built-in detection for Tailscale virtual private networking (`100.64.0.0/10` CGNAT range).
  - Devices on the same Tailscale tailnet communicate directly end-to-end encrypted with zero intermediary relays.
- **Presence & Offline Enforcement**:
  - The Windows companion sends presence heartbeats every 20 seconds.
  - If the PC is suspended, powered off, or disconnected, it is marked **OFFLINE** after 60 seconds of silence.
  - Remote tasks dispatched while the PC is offline fail immediately with `TARGET_DEVICE_OFFLINE`. ULTRON never fabricates task execution.

---

## 4. Reconnection & Duplicate Command Prevention

Network transitions (e.g., leaving Wi-Fi and transitioning to cellular data) frequently cause TCP resets and request retries. To guarantee that commands are not duplicated:

1. Every command carries an **`idempotencyKey`** (e.g. `and-1730644000-8421`).
2. The Central Brain indexes executed command IDs in an in-memory and durable cache.
3. If an identical `idempotencyKey` arrives, the backend returns the cached dispatch outcome without re-queueing or re-executing the action.
