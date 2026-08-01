// backend/src/config.js
//
// Loopback-only configuration for the Stage 2 backend skeleton.
//
// The host is UNCONDITIONALLY 127.0.0.1. There is, by design, NO mechanism to
// bind 0.0.0.0, a LAN address, or any other override: a HOST/ADDRESS
// environment variable is deliberately never read. This is a hard security
// boundary for this stage (see AGENTS.md §7 — LAN upload is permanently out of
// scope).

export const DEFAULT_PORT = 3001;
export const host = "127.0.0.1";

// Fixed, safe message — never echoes the offending input and never contains a
// stack trace or local path.
const PORT_RANGE_MESSAGE =
  "Invalid PORT: must be an integer between 1 and 65535.";

/**
 * Resolve the listen port from an environment-like object.
 *
 * - Absent / null / blank PORT -> DEFAULT_PORT (3001).
 * - A decimal integer string in [1, 65535] -> that integer.
 * - Anything else (including 0, 65536, negatives, decimals, hex, junk) -> a
 *   fixed, safe Error.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {number}
 */
export function resolvePort(env = process.env) {
  const raw = env?.PORT;
  if (raw === undefined || raw === null) {
    return DEFAULT_PORT;
  }
  // A blank or whitespace-only value is treated as "not provided" -> default.
  const trimmed = String(raw).trim();
  if (trimmed === "") {
    return DEFAULT_PORT;
  }
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error(PORT_RANGE_MESSAGE);
  }
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(PORT_RANGE_MESSAGE);
  }
  return value;
}

export const port = resolvePort();

export default { host, port, DEFAULT_PORT, resolvePort };
