import fs from 'fs';

const content = fs.readFileSync('docs/references/byox-readme.md', 'utf8');
const lines = content.split('\n');
let cur = '';
const cats = {};

lines.forEach(l => {
  if (l.startsWith('#### Build your own')) {
    cur = l.replace('#### Build your own', '').replace(/[`]/g, '').trim();
    cats[cur] = [];
  } else if (cur && l.trim().startsWith('*')) {
    cats[cur].push(l.trim());
  }
});

['Database', 'Search Engine', 'Shell', 'Web Browser', 'Web Server'].forEach(c => {
  console.log(`\n=== ${c} ===`);
  (cats[c] || []).forEach(t => console.log(`  ${t}`));
});
