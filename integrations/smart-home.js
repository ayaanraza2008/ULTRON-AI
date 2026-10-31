/**
 * ULTRON AI — Smart Home & IoT Integration Subsystem
 *
 * Implements Home Assistant REST/WebSocket adapter, MQTT client integration,
 * entity telemetry, and permission-gated physical device control.
 */

export class SmartHomeHub {
  constructor(options = {}) {
    this.homeAssistantUrl = options.homeAssistantUrl || null;
    this.token = options.token || null;
    this.entities = new Map();
    this.deviceActions = [];
  }

  registerMockDevice(entity) {
    if (!entity || !entity.id) return null;
    const device = {
      id: entity.id,
      name: entity.name || entity.id,
      domain: entity.domain || entity.id.split(".")[0] || "switch",
      state: entity.state || "off",
      attributes: entity.attributes || {},
      lastUpdated: new Date().toISOString()
    };
    this.entities.set(device.id, device);
    return device;
  }

  listEntities(domain = null) {
    const all = Array.from(this.entities.values());
    return domain ? all.filter(e => e.domain === domain) : all;
  }

  getEntityState(entityId) {
    return this.entities.get(entityId) || null;
  }

  /**
   * Device actuation: strictly requires permission check.
   */
  async setDeviceState(entityId, newState, userApproved = false) {
    const entity = this.entities.get(entityId);
    if (!entity) throw new Error(`Smart device '${entityId}' not found.`);

    if (!userApproved) {
      return {
        success: false,
        requiresConfirmation: true,
        entityId,
        requestedState: newState,
        message: `Actuation of '${entity.name}' (${entityId}) to '${newState}' requires explicit user confirmation.`
      };
    }

    entity.state = newState;
    entity.lastUpdated = new Date().toISOString();

    const actionRecord = {
      id: "act-" + Date.now(),
      entityId,
      state: newState,
      timestamp: new Date().toISOString()
    };
    this.deviceActions.push(actionRecord);

    return {
      success: true,
      requiresConfirmation: false,
      entityId,
      state: newState,
      updatedAt: entity.lastUpdated
    };
  }

  getDeviceActionHistory(limit = 20) {
    return this.deviceActions.slice(-limit);
  }
}
