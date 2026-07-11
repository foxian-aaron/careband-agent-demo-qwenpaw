import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { SAFETY_DISCLAIMER } from "../src/constants.js";
import { runQwenPawAgent } from "../src/agent/qwenpawProvider.js";

const result = {
  status_level: "attention",
  risk_score: 55,
  key_reasons: ["老人主动反馈头晕。"],
  recommended_action: "请护工今日内查看并记录现场情况。",
  caregiver_summary: "请在今日内查看陈伯当前状态。",
  family_summary: "陈伯今天有需要关注的变化，照护团队会继续跟进。",
  institution_summary: "陈伯进入今日关注队列。",
  safety_disclaimer: SAFETY_DISCLAIMER,
};

const listen = (server) =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address())));

test("QwenPaw provider parses the final SSE Agent JSON response", async (t) => {
  const server = http.createServer((request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/api/agent/process");
    assert.equal(request.headers["x-agent-id"], "careband_summary_agent");
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(
      `data: ${JSON.stringify({
        output: [{ content: [{ type: "text", text: JSON.stringify(result) }] }],
      })}\n\n`,
    );
    response.end(`data: ${JSON.stringify({ usage: { total_tokens: 128 } })}\n\n`);
  });
  t.after(() => server.close());
  const address = await listen(server);

  const response = await runQwenPawAgent(
    {
      elder_profile: { elder_id: "E001", name: "陈伯" },
      daily_snapshot: { elder_id: "E001", steps: 900 },
      baseline: { avg_steps_7d: 2100 },
      events: [],
      risk_result: {
        status_level: "attention",
        risk_score: 55,
        key_reasons: ["老人主动反馈头晕。"],
      },
    },
    {
      baseUrl: `http://127.0.0.1:${address.port}`,
      agentId: "careband_summary_agent",
      timeoutMs: 1000,
    },
  );

  assert.deepEqual(response.result, result);
  assert.equal(response.agentId, "careband_summary_agent");
});

test("QwenPaw provider surfaces a failed SSE event instead of hiding it", async (t) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(
      `data: ${JSON.stringify({
        status: "failed",
        error: { code: "MODEL_UNAUTHORIZED_ACCESS", message: "Model token expired" },
      })}\n\n`,
    );
  });
  t.after(() => server.close());
  const address = await listen(server);

  await assert.rejects(
    () =>
      runQwenPawAgent(
        { elder_profile: { elder_id: "E001" }, risk_result: {} },
        { baseUrl: `http://127.0.0.1:${address.port}`, timeoutMs: 1000 },
      ),
    /MODEL_UNAUTHORIZED_ACCESS: Model token expired/,
  );
});

test("QwenPaw provider times out instead of hanging the demo", async (t) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write("data: {}\n\n");
  });
  t.after(() => server.close());
  const address = await listen(server);

  await assert.rejects(
    () =>
      runQwenPawAgent(
        { elder_profile: { elder_id: "E001" }, risk_result: {} },
        { baseUrl: `http://127.0.0.1:${address.port}`, timeoutMs: 20 },
      ),
    /timed out after 20ms/,
  );
});

test("QwenPaw provider rejects a final prose or malformed JSON response", async (t) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(
      `data: ${JSON.stringify({
        output: [{ content: [{ type: "text", text: "Here is the answer: not JSON" }] }],
      })}\n\n`,
    );
  });
  t.after(() => server.close());
  const address = await listen(server);

  await assert.rejects(
    () =>
      runQwenPawAgent(
        { elder_profile: { elder_id: "E001" }, risk_result: {} },
        { baseUrl: `http://127.0.0.1:${address.port}`, timeoutMs: 1000 },
      ),
    /final output was not JSON-only/,
  );
});
