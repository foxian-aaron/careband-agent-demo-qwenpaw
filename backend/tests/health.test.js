// backend/tests/health.test.js
//
// Stage 2 health-check contract coverage:
//   * GET /api/health -> 200 JSON { ok, service, mode, timestamp(iso) }
//   * Unknown /api/*  -> JSON 404, no stack/path leak
//   * Error handler    -> safe 500 JSON, no stack/path leak
//   * config: host is unconditionally loopback 127.0.0.1; PORT resolves safely
//
// Each test binds the app to an OS-assigned ephemeral port on the loopback
// host and closes the server in a finally block.

import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { createApp, errorHandler } from "../src/app.js";
import { host, DEFAULT_PORT, resolvePort } from "../src/config.js";

function listen(application) {
  return new Promise((resolve, reject) => {
    const server = application.listen(0, host, () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://${host}:${port}` });
    });
    server.on("error", reject);
  });
}

function close(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

test("GET /api/health returns 200 JSON with ok, service, mode and a parseable ISO timestamp", async () => {
  const { server, baseUrl } = await listen(createApp());
  try {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("content-type").includes("application/json"));
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, "careband-agent-backend");
    assert.equal(body.mode, "local");
    const parsed = Date.parse(body.timestamp);
    assert.ok(Number.isFinite(parsed), "timestamp must be a parseable ISO date string");
  } finally {
    await close(server);
  }
});

test("unknown /api/* returns a JSON 404 that does not leak stack or path", async () => {
  const { server, baseUrl } = await listen(createApp());
  try {
    const res = await fetch(`${baseUrl}/api/does-not-exist`);
    assert.equal(res.status, 404);
    assert.ok(res.headers.get("content-type").includes("application/json"));
    const text = await res.text();
    const body = JSON.parse(text);
    assert.equal(body.ok, false);
    assert.equal(body.error, "not_found");
    assert.ok(!text.includes("stack"), "404 body must not leak a stack trace");
    assert.ok(!text.includes("at "), "404 body must not leak stack frames");
    assert.ok(!text.includes("Error"), "404 body must not leak error details");
  } finally {
    await close(server);
  }
});

test("error handler returns a safe 500 JSON and never leaks stack or local path", async () => {
  // Isolate the terminal error handler: build a minimal pipeline where a
  // throwing route is mounted before errorHandler, then assert the response.
  const app = express();
  app.get("/api/__boom", () => {
    throw new Error("SECRET_LEAK_TOKEN at C:\\internal\\path");
  });
  app.use(errorHandler);
  const { server, baseUrl } = await listen(app);
  try {
    const res = await fetch(`${baseUrl}/api/__boom`);
    assert.equal(res.status, 500);
    assert.ok(res.headers.get("content-type").includes("application/json"));
    const text = await res.text();
    const body = JSON.parse(text);
    assert.equal(body.ok, false);
    assert.equal(body.error, "internal_error");
    assert.ok(!text.includes("SECRET_LEAK_TOKEN"), "must not leak the error message");
    assert.ok(!text.includes("C:\\"), "must not leak a local file path");
    assert.ok(!text.includes("stack"), "must not leak a stack trace");
    assert.ok(!text.includes("at "), "must not leak stack frames");
  } finally {
    await close(server);
  }
});

test("config: host is unconditionally the loopback address 127.0.0.1", () => {
  assert.equal(host, "127.0.0.1");
});

test("config: server binds to the loopback host and serves health", async () => {
  const { server, baseUrl } = await listen(createApp());
  try {
    assert.ok(baseUrl.startsWith("http://127.0.0.1:"), "must bind to loopback");
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
  } finally {
    await close(server);
  }
});

test("config: resolvePort defaults to 3001 when PORT is absent or blank", () => {
  assert.equal(DEFAULT_PORT, 3001);
  assert.equal(resolvePort({}), DEFAULT_PORT);
  assert.equal(resolvePort({ PORT: "" }), DEFAULT_PORT);
  assert.equal(resolvePort({ PORT: "   " }), DEFAULT_PORT);
});

test("config: resolvePort accepts integers in the inclusive range 1..65535", () => {
  assert.equal(resolvePort({ PORT: "1" }), 1);
  assert.equal(resolvePort({ PORT: "3001" }), 3001);
  assert.equal(resolvePort({ PORT: "65535" }), 65535);
});

test("config: resolvePort rejects out-of-range or non-integer PORT with a fixed safe error", () => {
  for (const bad of ["0", "65536", "-1", "12.5", "abc", "0x10", "99999999999"]) {
    assert.throws(
      () => resolvePort({ PORT: bad }),
      /PORT/,
      `PORT=${JSON.stringify(bad)} should be rejected`,
    );
  }
});
