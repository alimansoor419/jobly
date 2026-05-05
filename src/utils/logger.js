import os from 'os';

const BASE_FIELDS = {
  pid: process.pid,
  hostname: os.hostname(),
  env: process.env.NODE_ENV ?? 'development',
  service: process.env.SERVICE_NAME ?? 'app',
};

const FORMAT = process.env.LOG_FORMAT ?? 'pretty'; // 'pretty' | 'json'

function sanitizeMeta(meta) {
  if (meta === null || meta === undefined) return undefined;
  const seen = new WeakSet();
  return JSON.parse(
    JSON.stringify(meta, (_key, val) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      return val;
    })
  );
}

const LEVEL_PAD = { info: 'INFO ', debug: 'DEBUG', warn: 'WARN ', error: 'ERROR' };

function formatPretty(level, message, meta) {
  const time = new Date().toTimeString().slice(0, 8); // HH:MM:SS
  const metaPart = meta ? ' ' + JSON.stringify(sanitizeMeta(meta)) : '';
  return `[${time}] ${LEVEL_PAD[level]} ${message}${metaPart}`;
}

function formatJson(level, message, meta) {
  const entry = {
    ...BASE_FIELDS,
    level,
    time: new Date().toTimeString().slice(0, 8),
    message,
    ...(meta ? { meta: sanitizeMeta(meta) } : {}),
  };
  return JSON.stringify(entry);
}

function serialize(level, message, meta) {
  return FORMAT === 'json'
    ? formatJson(level, message, meta)
    : formatPretty(level, message, meta);
}

function writeStdout(str) {
  try { process.stdout.write(str + '\n'); } catch { console.log(str); }
}
function writeStderr(str) {
  try { process.stderr.write(str + '\n'); } catch { console.error(str); }
}

export default {
  info:  (message, meta) => writeStdout(serialize('info',  message, meta)),
  debug: (message, meta) => writeStdout(serialize('debug', message, meta)),
  warn:  (message, meta) => writeStderr(serialize('warn',  message, meta)),
  error: (message, meta) => writeStderr(serialize('error', message, meta)),
};