// Structured JSON logger. Keys that can carry credentials are always redacted.
const REDACT = /(pass(word)?|secret|token|otp|code_hash|^code$|signature|authorization|cookie|api[_-]?key|card|cvv)/i;

function scrub(value, depth = 0) {
  if (value === null || value === undefined || depth > 4) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT.test(k) ? '[redacted]' : scrub(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 2000) return value.slice(0, 2000) + '…';
  return value;
}

function write(level, event, fields) {
  if (process.env.LOG_SILENT === 'true') return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...scrub(fields || {}) });
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const log = {
  info: (event, fields) => write('info', event, fields),
  warn: (event, fields) => write('warn', event, fields),
  error: (event, fields) => write('error', event, fields),
  scrub,
};
