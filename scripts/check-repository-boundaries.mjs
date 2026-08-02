import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fail = (message) => {
  throw new Error(`REPOSITORY_BOUNDARY_FAILED: ${message}`);
};

const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
export const isForbiddenPath = (file) => {
  const lower = file.toLowerCase();
  const name = lower.split("/").at(-1) ?? lower;
  if (
    lower
      .split("/")
      .some((part) => [".pio", "firmware", "hardware", "esp32", "nrf", "platformio", "private_data"].includes(part))
  ) return true;
  if (name === "platformio.ini" || /(?:esp32|nrf)/i.test(name)) return true;
  if (lower.includes("hardwaremode")) return true;
  if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) return true;
  if (/^(credentials?|secrets?)(\.|$)/i.test(name)) return true;
  if (/\.(sqlite|sqlite3|db)(?:-(?:wal|shm))?$/i.test(name)) return true;
  return /\.(xml|wav|mp3|m4a|aac|pem|key|p12|pfx|jks|keystore)$/i.test(name);
};

const secretPatterns = [
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /sk-[A-Za-z0-9]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bLTAI[A-Za-z0-9]{12,}\b/,
];

const extractedSecretPatterns = [
  /authorization\s*:\s*bearer\s+([^\s"']{12,})/i,
  /\b[A-Z][A-Z0-9_]*(?:API_KEY|ACCESS_KEY|SECRET_KEY)\s*=\s*["']?([^\s"'#]{12,})/i,
  /\b_authToken\s*=\s*["']?([^\s"'#]{12,})/i,
];

const isPlaceholder = (value) => {
  const normalized = value.trim().toLowerCase();
  return /^(?:<[^>]+>|\$\{[^}]+\}|\*+)$/.test(normalized)
    || /^(?:your[_-]?|example[_-]?|dummy[_-]?|test[_-]?|replace[_-]?|redacted|changeme)/.test(normalized);
};

export const containsSecret = (content) => {
  if (secretPatterns.some((pattern) => pattern.test(content))) return true;
  return content.split(/\r?\n/).some((line) => extractedSecretPatterns.some((pattern) => {
    const match = pattern.exec(line);
    return Boolean(match && !isPlaceholder(match[1]));
  }));
};

export const assertScannableStat = (file, stat) => {
  if (stat.isSymbolicLink()) fail(`symbolic link is not allowed: ${file}`);
  if (!stat.isFile()) return false;
  if (stat.size > 1024 * 1024) {
    fail(`file larger than 1 MiB requires explicit review: ${file}`);
  }
  return true;
};

export function scanRepository() {
  if (nodeMajor !== 22 || nodeMinor < 12) {
    fail(`Node 22 required; received ${process.version}`);
  }
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "buffer" },
  );
  const files = output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((value) => value.replaceAll("\\", "/"));

  for (const file of files) {
    if (isForbiddenPath(file)) fail(`forbidden tracked or pending path: ${file}`);
    let stat;
    try {
      stat = lstatSync(file);
    } catch {
      continue;
    }
    if (!assertScannableStat(file, stat)) continue;
    const content = readFileSync(file).toString("utf8");
    if (containsSecret(content)) fail(`secret signature detected in ${file}`);
  }
  process.stdout.write(`repository boundary check passed (${files.length} files)\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) scanRepository();
