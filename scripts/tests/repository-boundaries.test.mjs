import assert from "node:assert/strict";
import test from "node:test";

import {
  assertScannableStat,
  containsSecret,
  isForbiddenPath,
} from "../check-repository-boundaries.mjs";

test("forbidden repository paths fail closed", () => {
  for (const file of [
    "firmware/device/main.cpp",
    "hardware/device-notes.md",
    "src/esp32/adapter.ts",
    "src/nrf/adapter.ts",
    "tools/platformio/project.ini",
    "platformio.ini",
    "src/esp32Adapter.ts",
    "src/nrfBridge.ts",
    ".pio/build/firmware.bin",
    "private_data/export.csv",
    "docs/HardwareMode.md",
    ".env",
    ".env.local",
    "credentials.json",
    "careband.sqlite-wal",
    "careband.db-shm",
    "identity.pem",
    "identity.jks",
    "voice.m4a",
    "apple-health.xml",
  ]) {
    assert.equal(isForbiddenPath(file), true, file);
  }
});

test("safe public and evidence paths remain allowed", () => {
  for (const file of [
    ".env.example",
    "docs/rebuild/EVIDENCE/manifest.json",
    "docs/rebuild/EVIDENCE/qwenpaw-client.png",
    "src/App.tsx",
  ]) {
    assert.equal(isForbiddenPath(file), false, file);
  }
});

test("secret signatures are detected without embedding a real credential", () => {
  assert.equal(containsSecret(["ghp_", "A".repeat(24)].join("")), true);
  assert.equal(containsSecret(["sk-", "B".repeat(24)].join("")), true);
  assert.equal(containsSecret(["-----BEGIN ", "PRIVATE KEY-----"].join("")), true);
  assert.equal(containsSecret(["Authorization: Bearer ", "C".repeat(24)].join("")), true);
  assert.equal(containsSecret(["ZHIPU_API_KEY=", "D".repeat(24)].join("")), true);
  assert.equal(containsSecret(["//registry/:_authToken=", "E".repeat(24)].join("")), true);
  assert.equal(containsSecret(["LTAI", "F".repeat(16)].join("")), true);
  assert.equal(containsSecret("Authorization: Bearer <API_KEY>"), false);
  assert.equal(containsSecret("ZHIPU_API_KEY=YOUR_API_KEY"), false);
  assert.equal(containsSecret("requested_provider=mock"), false);
});

test("symbolic links and oversized files fail closed", () => {
  assert.throws(
    () => assertScannableStat("linked.txt", {
      isSymbolicLink: () => true,
      isFile: () => true,
      size: 10,
    }),
    /symbolic link is not allowed/,
  );
  assert.throws(
    () => assertScannableStat("large.bin", {
      isSymbolicLink: () => false,
      isFile: () => true,
      size: 1024 * 1024 + 1,
    }),
    /larger than 1 MiB/,
  );
});
