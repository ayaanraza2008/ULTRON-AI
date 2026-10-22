(() => {
  'use strict';
  const PARENT_ORIGIN = 'https://ultron-ai-zvd7.onrender.com';
  const ACTIONS = new Set([
    'set_layer_visibility', 'zoom_to_globe', 'adjust_camera_zoom',
    'fly_to_location', 'set_visual_style', 'stop_tracking',
    'set_context_mode', 'get_current_view_state', 'track_entity'
  ]);
  const LAYERS = new Set([
    'flights','military','ais-live-vessels','satellites','rocket-launches',
    'earthquakes','local-firms','fire-perimeters','weather-cyclones',
    'weather-radar','weather-satellite','weather-lightning','wind',
    'air-quality','traffic','transit','bikeshare','cctv','alpr-cameras',
    'radio','street-level','recent-imagery','directions','military-installations',
    'local-datacenters','local-dams','telegeography-submarine-cables','gnss-integrity'
  ]);
  const STYLES = new Set(['normal','retro','surveillance','thermal','anime','noir','snow']);
  function valid(name, args) {
    if (!ACTIONS.has(name) || !args || typeof args !== 'object' || Array.isArray(args)) return false;
    if (name === 'set_layer_visibility') return LAYERS.has(args.layerId) && typeof args.enabled === 'boolean';
    if (name === 'set_visual_style') return STYLES.has(args.style);
    if (name === 'adjust_camera_zoom') return ['in','out'].includes(args.direction) && ['little','medium','lot'].includes(args.amount);
    if (name === 'fly_to_location') {
      if (typeof args.query === 'string') return args.query.trim().length > 0 && args.query.length <= 160;
      return Number.isFinite(args.latitude) && args.latitude >= -90 && args.latitude <= 90 && Number.isFinite(args.longitude) && args.longitude >= -180 && args.longitude <= 180;
    }
    if (name === 'set_context_mode') return ['off','contacts','flights','space-missions','missions'].includes(args.mode);
    if (name === 'track_entity') return ['flights','military','ais-live-vessels','satellites'].includes(args.layerId) && typeof args.query === 'string' && args.query.trim().length > 0 && args.query.length <= 120;
    return name === 'zoom_to_globe' || name === 'stop_tracking' || name === 'get_current_view_state';
  }
  window.addEventListener('message', async event => {
    if (event.source !== window.parent || event.origin !== PARENT_ORIGIN) return;
    const message = event.data;
    if (!message || message.type !== 'ultron:world-action' || typeof message.requestId !== 'string') return;
    const reply = payload => window.parent.postMessage({ type: 'ultron:world-action-result', requestId: message.requestId, ...payload }, PARENT_ORIGIN);
    try {
      if (!valid(message.name, message.args)) throw new Error('This globe action is not allowlisted or its arguments are invalid.');
      const gev = window.__godsEyeView;
      const runner = gev?.voiceCommands?.runner;
      if (typeof runner !== 'function') throw new Error('The globe control engine is not ready yet.');
      const result = await runner(message.name, message.args, {});
      let summary;
      try { summary = typeof result === 'string' ? result : JSON.stringify(result); }
      catch { summary = String(result); }
      reply({ ok: true, result: String(summary || 'Action completed.').slice(0, 5000) });
    } catch (error) {
      reply({ ok: false, error: String(error?.message || 'Globe action failed').slice(0, 500) });
    }
  });
  window.parent.postMessage({ type: 'ultron:world-ready', version: 1 }, PARENT_ORIGIN);
})();