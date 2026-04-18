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
