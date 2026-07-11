import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createApp } from "../src/server.js";

const originalServeStaticFrontend = process.env.SERVE_STATIC_FRONTEND;
const originalHardwareMode = process.env.HARDWARE_MODE;
process.env.DATABASE_PATH = ":memory:";
process.env.AGENT_PROVIDER = "mock";

afterEach(() => {
  if (originalServeStaticFrontend === undefined) {
    delete process.env.SERVE_STATIC_FRONTEND;
  } else {
    process.env.SERVE_STATIC_FRONTEND = originalServeStaticFrontend;
  }
  if (originalHardwareMode === undefined) {
    delete process.env.HARDWARE_MODE;
  } else {
    process.env.HARDWARE_MODE = originalHardwareMode;
  }
});

async function withServer(run, appOptions = {}) {
  const server = createApp(appOptions).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("hardware LAN mode exposes only health and normalized event ingestion", async () => {
  process.env.SERVE_STATIC_FRONTEND = "false";
  process.env.HARDWARE_MODE = "true";

  await withServer(async (baseUrl) => {
    const healthResponse = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json();
    assert.equal(health.ok, true);
    assert.equal("elders" in health, false);

    const eventResponse = await fetch(`${baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        elder_id: "E001",
        event_type: "sos",
        source: "esp32",
        occurred_at: new Date().toISOString(),
        payload: { action: "long_press", device_id: "CAREBAND-DEMO-01" },
      }),
    });
    assert.equal(eventResponse.status, 201);

    assert.equal((await fetch(`${baseUrl}/api/dashboard`)).status, 403);
    assert.equal(
      (
        await fetch(`${baseUrl}/api/snapshots`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/api/tasks/not-allowed`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "resolved" }),
        })
      ).status,
      403,
    );

    const frontendResponse = await fetch(`${baseUrl}/`);
    assert.equal(frontendResponse.status, 404);
  }, { isLoopbackRequest: () => false });
});
