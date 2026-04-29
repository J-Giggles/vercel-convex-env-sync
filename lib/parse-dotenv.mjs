/**
 * Minimal .env parser (KEY=VALUE, supports quoted values, full-line `#` comments,
 * and inline ` # comment` for unquoted values).
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
    const isQuoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (isQuoted) {
      value = value.slice(1, -1);
    } else {
      const inlineComment = value.match(/\s#/);
      if (inlineComment) value = value.slice(0, inlineComment.index);
      value = value.trimEnd();
    }
    map.set(key, value);
  }
  return map;
}

/**
 * One `KEY=value` line (minimal quoting; empty value is `KEY=`).
 *
 * @param {string} key
 * @param {string} value
 */
export function formatEnvLine(key, value) {
  const v = value ?? "";
  if (v === "") return `${key}=`;
  const needsQuote = /[\s#"'\\\r\n]/.test(v);
  if (!needsQuote) return `${key}=${v}`;
  return `${key}="${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
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
    lines.push(formatEnvLine(k, v));
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}
