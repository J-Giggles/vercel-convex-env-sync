/**
 * stdin prompt for continuing after drift warnings.
 */
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

/**
 * @param {string} message
 * @returns {Promise<boolean>}
 */
export async function confirmOrCancel(message) {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = (await rl.question(`${message} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

/**
 * @template T
 * @param {string} header
 * @param {T[]} items
 * @param {(item: T, index: number) => string} formatLine
 * @returns {Promise<number>} 0-based index
 */
export async function chooseIndex(header, items, formatLine) {
  if (items.length === 0) {
    throw new Error("chooseIndex: no items");
  }
  const rl = readline.createInterface({ input, output });
  try {
    console.log(header);
    items.forEach((item, i) => {
      console.log(`  ${i + 1}) ${formatLine(item, i)}`);
    });
    for (;;) {
      const raw = (await rl.question(`Enter 1–${items.length}: `)).trim();
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n) && n >= 1 && n <= items.length) {
        return n - 1;
      }
      console.log(`Invalid choice. Type a number from 1 to ${items.length}.`);
    }
  } finally {
    rl.close();
  }
}

/**
 * @param {string} message
 * @returns {Promise<boolean>}
 */
export async function chooseConvexUseProd(message) {
  const rl = readline.createInterface({ input, output });
  try {
    console.log(message);
    for (;;) {
      const raw = (await rl.question(`Type "dev" (development) or "prod" (production Convex): `))
        .trim()
        .toLowerCase();
      if (raw === "dev" || raw === "development") return false;
      if (raw === "prod" || raw === "production") return true;
      console.log('Expected "dev" or "prod".');
    }
  } finally {
    rl.close();
  }
}
