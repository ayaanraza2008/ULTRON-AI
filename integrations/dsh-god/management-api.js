/**
 * ULTRON AI — DSH-GOD Management REST API Handlers
 * 
 * Provides unified REST API endpoints for ULTRON Cyber-HUD and backend controllers:
 * /api/integrations/dsh-god/*
 */

import express from 'express';
import { getDshConfig, updateDshConfig } from './config.js';
import { listProviders, getProvider, configureProvider, getProviderRegistryStats } from './provider-registry.js';
import { listCombos, getCombo, registerOrUpdateCombo, deleteCombo } from './combo-router.js';
import { getUnifiedCatalog, searchCatalog } from './model-discovery.js';
import { executeInference } from './inference-router.js';
import { getCumulativeSavings, resetCumulativeSavings, describeSavings } from './token-optimizer.js';
import { getUsageSummary, clearUsage } from './usage-monitor.js';
import { startGatewayServer, stopGatewayServer, getGatewayStatus } from './gateway-manager.js';
import { listAccountChannels, getAccountChannel, configureAccountChannel, getAccountChannelStatusReport } from './account-channels.js';
import { getKiloStatus } from './kilo-gateway.js';
import { getOpenCodeStatus } from './open-code-gateway.js';
import { THIRD_PARTY_LOGGING_DISCLOSURES } from './privacy-policy.js';

export function createDshGodRouter() {
  const router = express.Router();

  // GET /status
  router.get('/status', async (req, res) => {
    try {
      const stats = getProviderRegistryStats();
      const gateway = getGatewayStatus();
      const savings = getCumulativeSavings();
      const usage = getUsageSummary();
      const openCode = await getOpenCodeStatus();
      const kilo = getKiloStatus();

      res.json({
        ok: true,
        version: getDshConfig().version,
        gateway,
        providers: stats,
        tokenSavings: {
          ...savings,
          description: describeSavings(),
        },
        usage: {
          totalRequests: usage.totalRequests,
          successRatePercent: usage.successRatePercent,
          averageLatencyMs: usage.averageLatencyMs,
        },
        lanes: {
          openCode,
          kilo,
        },
        privacyDisclosures: THIRD_PARTY_LOGGING_DISCLOSURES,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /providers
  router.get('/providers', (req, res) => {
    try {
      const { category, authKind, format, search, enabledOnly } = req.query;
      const providers = listProviders({
        category,
        authKind,
        format,
        search,
        enabledOnly: enabledOnly === 'true',
      });
      res.json({ ok: true, count: providers.length, providers });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /providers/:id
  router.get('/providers/:id', (req, res) => {
    try {
      const provider = getProvider(req.params.id);
      if (!provider) return res.status(404).json({ ok: false, error: 'Provider not found' });
      res.json({ ok: true, provider });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /providers/:id
  router.post('/providers/:id', (req, res) => {
    try {
      const { enabled, apiKey, baseUrl } = req.body || {};
      const updated = configureProvider(req.params.id, { enabled, apiKey, baseUrl });
      res.json({ ok: true, provider: updated });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // GET /combos
  router.get('/combos', (req, res) => {
    try {
      const combos = listCombos();
      res.json({ ok: true, count: combos.length, combos });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /combos
  router.post('/combos', (req, res) => {
    try {
      const saved = registerOrUpdateCombo(req.body);
      res.json({ ok: true, combo: saved });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // DELETE /combos/:id
  router.delete('/combos/:id', (req, res) => {
    try {
      const deleted = deleteCombo(req.params.id);
      res.json({ ok: true, deleted });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /catalog
  router.get('/catalog', async (req, res) => {
    try {
      const { query, channel, freeOnly, visionOnly } = req.query;
      const catalog = await searchCatalog({
        query,
        channel,
        freeOnly: freeOnly === 'true',
        visionOnly: visionOnly === 'true',
      });
      res.json({ ok: true, count: catalog.length, catalog });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /usage
  router.get('/usage', (req, res) => {
    try {
      const usage = getUsageSummary();
      res.json({ ok: true, usage });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /usage/reset
  router.post('/usage/reset', (req, res) => {
    try {
      clearUsage();
      res.json({ ok: true, message: 'Usage metrics reset.' });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /token-saver
  router.get('/token-saver', (req, res) => {
    try {
      const savings = getCumulativeSavings();
      res.json({
        ok: true,
        savings,
        description: describeSavings(),
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /token-saver/reset
  router.post('/token-saver/reset', (req, res) => {
    try {
      resetCumulativeSavings();
      res.json({ ok: true, message: 'Token savings counters reset.' });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /gateway/start
  router.post('/gateway/start', async (req, res) => {
    try {
      const result = await startGatewayServer(req.body);
      res.json({ ok: true, gateway: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /gateway/stop
  router.post('/gateway/stop', async (req, res) => {
    try {
      const result = await stopGatewayServer();
      res.json({ ok: true, gateway: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /channels
  router.get('/channels', (req, res) => {
    try {
      const report = getAccountChannelStatusReport();
      res.json({ ok: true, report });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /channels/:id
  router.post('/channels/:id', (req, res) => {
    try {
      const updated = configureAccountChannel(req.params.id, req.body);
      res.json({ ok: true, channel: updated });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // POST /chat
  router.post('/chat', async (req, res) => {
    try {
      const result = await executeInference(req.body);
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
