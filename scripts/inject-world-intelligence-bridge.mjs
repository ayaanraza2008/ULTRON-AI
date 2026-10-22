import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.resolve(root, '.build-gods-eye-view', 'dist');
const source = path.resolve(root, 'public', 'world-intelligence-bridge.js');
const target = path.join(dist, 'ultron-bridge.js');
const htmlPath = path.join(dist, 'index.html');
await copyFile(source, target);
const html = await readFile(htmlPath, 'utf8');
if (!html.includes('</body>')) throw new Error('God’s Eye View built HTML has no body close tag.');
const tag = '<script src="/ultron-bridge.js" defer></script>';
if (!html.includes(tag)) await writeFile(htmlPath, html.replace('</body>', tag + '\n</body>'));
console.log('Injected ULTRON World Intelligence action bridge into pinned globe build.');
