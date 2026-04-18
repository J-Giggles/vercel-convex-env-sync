/**
 * Minimal .env parser (KEY=VALUE, supports quoted values and # comments).
 * @param {string} content
 * @returns {Map<string, string>}
 */
export function parseDotenv(content) {
  const map = new Map();
  if (!content) return map;
  const lines = content.split(/\r?\n/);
  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map.set(key, value);
  }
  return map;
}

/**
 * @param {Map<string, string>} map
 * @param {{ sortKeys?: boolean }} [opts]
 */
export function serializeDotenv(map, opts = {}) {
  const sortKeys = opts.sortKeys !== false;
  const keys = sortKeys ? [...map.keys()].sort() : [...map.keys()];
  const lines = [];
  for (const k of keys) {
    const v = map.get(k);
    if (v === undefined) continue;
    const needsQuote = /[\s#"'\\]/.test(v) || v === "";
    lines.push(
      needsQuote ? `${k}="${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : `${k}=${v}`
    );
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}
