import test from 'node:test';
import assert from 'node:assert/strict';
import { ByoxWebIntelligence } from '../integrations/browser/byox-web-intelligence.js';

test('ByoxWebIntelligence: extract title, OpenGraph metadata, and canonical URL', () => {
  const extractor = new ByoxWebIntelligence();
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>ULTRON Autonomous AI System</title>
        <meta name="description" content="Personal AI OS with real-world capability">
        <meta property="og:title" content="ULTRON Super High-Fi">
        <meta property="og:description" content="Multimodal JARVIS-inspired agent">
        <link rel="canonical" href="https://ultron.ai/docs">
      </head>
      <body>
        <article>
          <h1>Welcome to ULTRON</h1>
          <p>ULTRON provides autonomous browser and desktop automation.</p>
        </article>
      </body>
    </html>
  `;

  const meta = extractor.extractMetadata(html, 'https://ultron.ai');
  assert.equal(meta.title, 'ULTRON Autonomous AI System');
  assert.equal(meta.description, 'Personal AI OS with real-world capability');
  assert.equal(meta.og.title, 'ULTRON Super High-Fi');
  assert.equal(meta.og.description, 'Multimodal JARVIS-inspired agent');
  assert.equal(meta.canonical, 'https://ultron.ai/docs');
  assert.equal(meta.isSpaOrEmpty, false);
});

test('ByoxWebIntelligence: extract clean article text, stripping scripts and boilerplate', () => {
  const extractor = new ByoxWebIntelligence();
  const html = `
    <div>
      <nav><a href="/home">Home</a></nav>
      <script>var tracker = 123;</script>
      <style>.ad { display: none; }</style>
      <article>
        <h1>Autonomous Agent Systems</h1>
        <p>Agents collaborate to solve multi-step coding and verification missions.</p>
        <p>Each agent possesses isolated roles and tool registries.</p>
      </article>
      <footer>Copyright 2026</footer>
    </div>
  `;

  const text = extractor.extractArticleText(html);
  assert.ok(text.includes('Autonomous Agent Systems'));
  assert.ok(text.includes('Agents collaborate to solve multi-step coding'));
  assert.ok(!text.includes('var tracker'));
  assert.ok(!text.includes('display: none'));
  assert.ok(!text.includes('Copyright 2026'));
});

test('ByoxWebIntelligence: extract links and resolve relative URLs', () => {
  const extractor = new ByoxWebIntelligence();
  const html = `
    <div>
      <a href="/docs/intro">Documentation</a>
      <a href="https://github.com/ayaanraza2008/ULTRON-AI">GitHub Repo</a>
      <a href="#section-top">Skip</a>
      <a href="javascript:void(0)">Do Nothing</a>
    </div>
  `;

  const links = extractor.extractLinks(html, 'https://ultron.ai/platform/');
  assert.equal(links.length, 2);
  assert.equal(links[0].url, 'https://ultron.ai/docs/intro');
  assert.equal(links[0].text, 'Documentation');
  assert.equal(links[1].url, 'https://github.com/ayaanraza2008/ULTRON-AI');
});
