import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const file = path.resolve(process.cwd(), '.build-gods-eye-view', 'src', 'voice', 'sessionCommands.js');
const source = await readFile(file, 'utf8');
const anchor = '  controls.session = session;\n';
const addition = '  controls.runner = runner;\n';
if (source.includes(addition)) {
  console.log('World Intelligence runner export is already patched.');
} else {
  if (!source.includes(anchor)) throw new Error('Upstream voice control construction changed; refusing unsafe patch.');
  await writeFile(file, source.replace(anchor, anchor + addition));
  console.log('Exposed the existing allowlisted voice action runner for the authenticated ULTRON parent bridge.');
}
