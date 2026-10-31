/**
 * ULTRON AI — DSH-GOD Local Answers Heuristic
 * 
 * Provides instant local evaluations for deterministic, system,
 * clock, health, and echo requests without triggering upstream network egress.
 */

export function tryLocalAnswer(messages = []) {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUserMsg || typeof lastUserMsg.content !== 'string') return null;

  const text = lastUserMsg.content.trim().toLowerCase();

  // Instant Ping / Echo
  if (text === 'ping' || text === '/ping') {
    return {
      answered: true,
      content: 'pong',
      source: 'local-fast-path',
    };
  }

  // Current system time / date
  if (text === 'what time is it' || text === 'current time' || text === 'what is the date today' || text === 'time' || text === 'date') {
    return {
      answered: true,
      content: `System time: ${new Date().toLocaleString('en-US', { timeZoneName: 'short' })} (${new Date().toISOString()})`,
      source: 'local-fast-path',
    };
  }

  // ULTRON & DSH Gateway Status
  if (text === 'system status' || text === 'ultron status' || text === 'dsh status') {
    return {
      answered: true,
      content: `ULTRON AI System Operational. DSH-GOD Gateway Lane Active. Node.js ${process.version} on ${process.platform}.`,
      source: 'local-fast-path',
    };
  }

  return null;
}
