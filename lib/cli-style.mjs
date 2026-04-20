/**
 * ANSI styling for env:sync CLI (no extra dependencies).
 */

const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

/** Visible prefix for all sync tool output. */
export const SYNC_LABEL = `${c.dim}[${c.cyan}env:sync${c.dim}]${c.reset}`;

/**
 * @param {string} message — text after `[env:sync] ` (no newline)
 */
export function syncInfo(message) {
  console.log(`${SYNC_LABEL} ${message}`);
}

/**
 * @param {string} message
 */
export function syncWarn(message) {
  console.warn(`${SYNC_LABEL} ${c.yellow}${message}${c.reset}`);
}

/**
 * @param {string} message
 */
export function syncError(message) {
  console.error(`${SYNC_LABEL} ${c.red}${message}${c.reset}`);
}

/**
 * @param {string} message
 */
export function syncSuccess(message) {
  console.log(`${SYNC_LABEL} ${c.green}${message}${c.reset}`);
}

/**
 * @param {string} message — dim secondary line
 */
export function syncDim(message) {
  console.log(`${SYNC_LABEL} ${c.dim}${message}${c.reset}`);
}
