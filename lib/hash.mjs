/**
 * Canonical SHA-256 of a string key/value map for drift detection.
 */
import crypto from "node:crypto";

/**
 * @param {Map<string, string>} map
 */
export function hashEnvMap(map) {
  const keys = [...map.keys()].sort();
  const lines = keys.map((k) => `${k}=${map.get(k) ?? ""}`);
  const body = lines.join("\n");
  return crypto.createHash("sha256").update(body, "utf8").digest("hex");
}
