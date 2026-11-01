(() => {
  'use strict';
  // ULTRON AI — World Intelligence Bridge (God's Eye View Integration)
  // Production Frontend Origin: https://ultron-core-interface.onrender.com
  const PRIMARY_PARENT_ORIGIN = 'https://ultron-core-interface.onrender.com';
  const ALLOWED_PARENT_ORIGINS = new Set([
    PRIMARY_PARENT_ORIGIN,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:10000',
    'http://127.0.0.1:10000'
  ]);

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
    const exact = keys => Object.keys(args).every(key => keys.includes(key));
    if (name === 'set_layer_visibility') return exact(['layerId','enabled']) && LAYERS.has(args.layerId) && typeof args.enabled === 'boolean';
    if (name === 'set_visual_style') return exact(['style']) && STYLES.has(args.style);
    if (name === 'adjust_camera_zoom') return exact(['direction','amount']) && ['in','out'].includes(args.direction) && ['little','medium','lot'].includes(args.amount);
    if (name === 'fly_to_location') return exact(['query']) && typeof args.query === 'string' && args.query.trim().length > 0 && args.query.length <= 160;
    if (name === 'set_context_mode') return exact(['mode']) && ['off','contacts','flights','space-missions','missions'].includes(args.mode);
    if (name === 'track_entity') return exact(['layerId','query']) && ['flights','military','ais-live-vessels','satellites'].includes(args.layerId) && typeof args.query === 'string' && args.query.trim().length > 0 && args.query.length <= 120;
    return ['zoom_to_globe','stop_tracking','get_current_view_state'].includes(name) && Object.keys(args).length === 0;
  }

  window.addEventListener('message', async event => {
    if (event.source !== window.parent || !ALLOWED_PARENT_ORIGINS.has(event.origin)) return;
    const message = event.data;
    if (!message || message.type !== 'ultron:world-action' || typeof message.requestId !== 'string') return;
    const targetOrigin = event.origin;
    const reply = payload => window.parent.postMessage({ type: 'ultron:world-action-result', requestId: message.requestId, ...payload }, targetOrigin);
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

  try {
    window.parent.postMessage({ type: 'ultron:world-ready', version: 1 }, PRIMARY_PARENT_ORIGIN);
  } catch {}
})();
