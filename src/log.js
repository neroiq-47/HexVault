// One JSON object per line, which Railway parses into structured logs.
export function log(level, msg, extra = {}) {
  const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...extra });
  (level === 'error' ? console.error : console.log)(line);
}
