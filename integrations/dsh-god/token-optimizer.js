/**
 * ULTRON AI — DSH-GOD Token Optimizer & RTK Compaction Engine
 * 
 * Provides automated compaction of tool outputs, terminal logs, and system data:
 * - git-diff, git-status, git-log compaction
 * - grep, find, ls, tree output compaction
 * - Smart truncate (120 head / 60 tail) for arbitrary large payloads
 * - Prompt shaping (Caveman & Ponytail directives)
 * - Cumulative token savings metrics and accounting
 */

import { DSH_CONFIG } from './config.js';

const NOISE_DIRS = new Set([
  'node_modules', '.git', 'target', '__pycache__', '.next', 'dist',
  'build', '.cache', '.turbo', '.vercel', '.pytest_cache', '.mypy_cache',
  '.tox', '.venv', 'venv', 'env', 'coverage', '.nyc_output', '.idea', '.vscode'
]);

// --- RTK Filters ---

export function filterGitDiff(diff, maxHunkLines = 100) {
  if (typeof diff !== 'string' || !diff.includes('diff --git')) return diff;
  const lines = diff.split('\n');
  const result = [];
  let currentFile = '';
  let added = 0;
  let removed = 0;
  let inHunk = false;
  let hunkShown = 0;
  let hunkSkipped = 0;

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      if (hunkSkipped > 0) {
        result.push(`  ... (${hunkSkipped} lines truncated)`);
        hunkSkipped = 0;
      }
      if (currentFile && (added > 0 || removed > 0)) {
        result.push(`  +${added} -${removed}`);
      }
      const parts = line.split(' b/');
      currentFile = parts.length > 1 ? parts.slice(1).join(' b/') : 'unknown';
      result.push(`\n${currentFile}`);
      added = 0;
      removed = 0;
      inHunk = false;
      hunkShown = 0;
    } else if (line.startsWith('@@')) {
      if (hunkSkipped > 0) {
        result.push(`  ... (${hunkSkipped} lines truncated)`);
        hunkSkipped = 0;
      }
      inHunk = true;
      hunkShown = 0;
      result.push(`  ${line}`);
    } else if (inHunk) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        added += 1;
        if (hunkShown < maxHunkLines) {
          result.push(`  ${line}`);
          hunkShown += 1;
        } else {
          hunkSkipped += 1;
        }
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        removed += 1;
        if (hunkShown < maxHunkLines) {
          result.push(`  ${line}`);
          hunkShown += 1;
        } else {
          hunkSkipped += 1;
        }
      } else if (hunkShown < maxHunkLines && !line.startsWith('\\')) {
        if (hunkShown > 0) {
          result.push(`  ${line}`);
          hunkShown += 1;
        }
      }
    }
  }

  if (hunkSkipped > 0) {
    result.push(`  ... (${hunkSkipped} lines truncated)`);
  }
  if (currentFile && (added > 0 || removed > 0)) {
    result.push(`  +${added} -${removed}`);
  }

  return result.join('\n');
}

export function filterGitStatus(input) {
  if (typeof input !== 'string') return input;
  const lines = input.split('\n');
  let branch = '';
  const stagedFiles = [];
  const modifiedFiles = [];
  const untrackedFiles = [];
  let staged = 0;
  let modified = 0;
  let untracked = 0;
  let conflicts = 0;

  let inUntrackedSection = false;

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('On branch ')) {
      branch = trimmed.replace('On branch ', '');
      continue;
    }
    if (trimmed.startsWith('## ')) {
      branch = trimmed.replace('## ', '');
      continue;
    }
    if (trimmed.startsWith('Untracked files:')) {
      inUntrackedSection = true;
      continue;
    }
    if (inUntrackedSection) {
      if (trimmed.startsWith('(') || trimmed.startsWith('no changes')) continue;
      if (trimmed.startsWith('Changes ') || trimmed.startsWith('nothing added')) {
        inUntrackedSection = false;
      } else if (raw.startsWith('\t') || raw.startsWith('  ')) {
        untracked++;
        if (untrackedFiles.length < 10) untrackedFiles.push(trimmed);
        continue;
      }
    }
    const longMatch = raw.match(/^\s*(modified|new file|deleted|renamed|both modified):\s+(.+)$/);
    if (longMatch) {
      const kind = longMatch[1];
      const path = longMatch[2].trim();
      if (kind === 'both modified') conflicts++;
      else if (kind === 'modified' || kind === 'deleted') {
        modified++;
        if (modifiedFiles.length < 10) modifiedFiles.push(path);
      } else if (kind === 'new file' || kind === 'renamed') {
        staged++;
        if (stagedFiles.length < 10) stagedFiles.push(path);
      }
      continue;
    }
    if (raw.length >= 3 && /^[ MADRCU?!][ MADRCU?!] /.test(raw)) {
      const x = raw[0];
      const y = raw[1];
      const file = raw.slice(3).trim();
      if (raw.slice(0, 2) === '??') {
        untracked++;
        if (untrackedFiles.length < 10) untrackedFiles.push(file);
      } else {
        if ('MADRC'.includes(x)) {
          staged++;
          if (stagedFiles.length < 10) stagedFiles.push(file);
        }
        if (x === 'U') conflicts++;
        if (y === 'M' || y === 'D') {
          modified++;
          if (modifiedFiles.length < 10) modifiedFiles.push(file);
        }
      }
    }
  }

  let out = '';
  if (branch) out += `* branch: ${branch}\n`;
  if (staged > 0) out += `+ Staged: ${staged} files (${stagedFiles.slice(0, 5).join(', ')}${staged > 5 ? '...' : ''})\n`;
  if (modified > 0) out += `~ Modified: ${modified} files (${modifiedFiles.slice(0, 5).join(', ')}${modified > 5 ? '...' : ''})\n`;
  if (untracked > 0) out += `? Untracked: ${untracked} files (${untrackedFiles.slice(0, 5).join(', ')}${untracked > 5 ? '...' : ''})\n`;
  if (conflicts > 0) out += `! Conflicts: ${conflicts} files\n`;
  if (staged === 0 && modified === 0 && untracked === 0 && conflicts === 0) {
    out += 'Clean working tree\n';
  }
  return out.trim();
}

export function filterGitLog(text, maxLines = 100) {
  if (typeof text !== 'string' || !text.includes('commit ')) return text;
  const lines = text.split('\n');
  const out = [];
  let inCommit = false;
  let subjectSeen = false;

  for (const raw of lines) {
    if (out.length >= maxLines) {
      out.push('... (git log truncated)');
      break;
    }
    const trimmed = raw.trim();
    if (/^commit [0-9a-f]{7,40}/i.test(trimmed)) {
      inCommit = true;
      subjectSeen = false;
      out.push(trimmed);
      continue;
    }
    if (inCommit) {
      if (/^(Author|Date):/i.test(trimmed)) {
        out.push(`  ${trimmed}`);
        continue;
      }
      if (!subjectSeen && raw.startsWith('    ') && trimmed.length > 0) {
        out.push(`  Subject: ${trimmed}`);
        subjectSeen = true;
        continue;
      }
    }
  }
  return out.join('\n');
}

export function filterGrep(text, maxPerFile = 10) {
  if (typeof text !== 'string') return text;
  const lines = text.split('\n');
  const fileCounts = new Map();
  const out = [];

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0 && colonIdx < 80) {
      const file = line.slice(0, colonIdx);
      const count = fileCounts.get(file) || 0;
      if (count < maxPerFile) {
        out.push(line);
        fileCounts.set(file, count + 1);
      } else if (count === maxPerFile) {
        out.push(`  ... (${file} more matches truncated)`);
        fileCounts.set(file, count + 1);
      }
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

export function filterDirectoryListing(text) {
  if (typeof text !== 'string') return text;
  const lines = text.split('\n');
  const filtered = [];
  let noiseCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const parts = trimmed.split(/[\/\\]/);
    const hasNoise = parts.some(p => NOISE_DIRS.has(p.toLowerCase()));
    if (hasNoise) {
      noiseCount++;
    } else {
      filtered.push(line);
    }
  }
  if (noiseCount > 0) {
    filtered.push(`[Token Optimizer: omitted ${noiseCount} noise directory entries (node_modules, .git, etc.)]`);
  }
  return filtered.join('\n');
}

export function smartTruncate(text, head = 120, tail = 60) {
  if (typeof text !== 'string') return text;
  const lines = text.split('\n');
  if (lines.length <= head + tail + 20) return text;
  
  const headLines = lines.slice(0, head);
  const tailLines = lines.slice(-tail);
  const omitted = lines.length - head - tail;

  return [
    ...headLines,
    `\n... [Token Optimizer: ${omitted} lines truncated for token efficiency] ...\n`,
    ...tailLines,
  ].join('\n');
}

/**
 * Autodetect content type and apply best RTK filter
 */
export function compactContent(content) {
  if (typeof content !== 'string' || content.length < 400) return content;

  if (content.includes('diff --git')) {
    return filterGitDiff(content);
  }
  if (content.includes('On branch ') || (content.includes('?? ') && content.includes(' M '))) {
    return filterGitStatus(content);
  }
  if (content.includes('commit ') && (content.includes('Author:') || content.includes('Date:'))) {
    return filterGitLog(content);
  }
  if (content.includes('node_modules') || content.includes('__pycache__')) {
    return filterDirectoryListing(content);
  }

  // Fallback to smart truncate if long
  if (content.split('\n').length > 250) {
    return smartTruncate(content);
  }

  return content;
}

// --- Prompt Shaping ---

export const CAVEMAN_PROMPT = `[Tone: High information density. Answer directly. Strip conversational filler, greetings, and repetitive recaps. Focus on code, facts, and actionable instructions.]`;
export const PONYTAIL_PROMPT = `[Architecture-first response: Lead with file paths, concise architectural explanation, and production-ready diffs. Minimize tangential commentary.]`;

export function applyPromptShaping(messages = [], mode = 'caveman') {
  if (!messages || messages.length === 0) return messages;
  const instruction = mode === 'ponytail' ? PONYTAIL_PROMPT : CAVEMAN_PROMPT;
  
  const copy = [...messages];
  const first = copy[0];
  if (first.role === 'system') {
    copy[0] = { ...first, content: `${instruction}\n\n${first.content}` };
  } else {
    copy.unshift({ role: 'system', content: instruction });
  }
  return copy;
}

// --- Request Optimization & Metrics ---

export function emptySavings() {
  return {
    bytesBefore: 0,
    bytesAfter: 0,
    savedBytes: 0,
    savedPercent: 0,
    calls: 0,
    blocksCompacted: 0,
  };
}

let cumulativeSavings = emptySavings();

export function getCumulativeSavings() {
  return { ...cumulativeSavings };
}

export function resetCumulativeSavings() {
  cumulativeSavings = emptySavings();
  return cumulativeSavings;
}

export function optimizePayload(payload = {}) {
  if (!DSH_CONFIG.tokenSaver.enabled) {
    return { payload, stats: { savedBytes: 0, savedPercent: 0 } };
  }

  const rawJson = JSON.stringify(payload);
  const bytesBefore = Buffer.byteLength(rawJson, 'utf8');
  let blocksCompacted = 0;

  const optimized = { ...payload };

  if (Array.isArray(optimized.messages)) {
    optimized.messages = optimized.messages.map(msg => {
      if (typeof msg.content === 'string' && msg.content.length > 500) {
        const compacted = compactContent(msg.content);
        if (compacted.length < msg.content.length) {
          blocksCompacted++;
          return { ...msg, content: compacted };
        }
      }
      return msg;
    });
  }

  const afterJson = JSON.stringify(optimized);
  const bytesAfter = Buffer.byteLength(afterJson, 'utf8');
  const savedBytes = Math.max(0, bytesBefore - bytesAfter);
  const savedPercent = bytesBefore > 0 ? Math.round((savedBytes / bytesBefore) * 100) : 0;

  // Update cumulative counters
  cumulativeSavings.bytesBefore += bytesBefore;
  cumulativeSavings.bytesAfter += bytesAfter;
  cumulativeSavings.savedBytes += savedBytes;
  cumulativeSavings.calls += 1;
  cumulativeSavings.blocksCompacted += blocksCompacted;
  cumulativeSavings.savedPercent = cumulativeSavings.bytesBefore > 0
    ? Math.round((cumulativeSavings.savedBytes / cumulativeSavings.bytesBefore) * 100)
    : 0;

  return {
    payload: optimized,
    stats: {
      bytesBefore,
      bytesAfter,
      savedBytes,
      savedPercent,
      blocksCompacted,
    },
  };
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function describeSavings() {
  const s = cumulativeSavings;
  if (s.calls === 0) return 'Token Optimizer: No requests processed yet.';
  return `Token Optimizer: ${formatBytes(s.savedBytes)} saved across ${s.calls} requests (${s.savedPercent}% reduction, ${s.blocksCompacted} blocks compacted).`;
}
