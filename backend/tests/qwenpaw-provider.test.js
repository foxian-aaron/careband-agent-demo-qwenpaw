// backend/tests/qwenpaw-provider.test.js
//
// Stage 7B — QwenPaw Desktop Provider transport bridge contract coverage.
// Pure loopback tests: a configurable node:http fake server stands in for the
// QwenPaw Desktop runtime. No real QwenPaw / GLM is ever contacted. Covers the
// success trace, exact request shapes (single POST), dynamic port, config
// validation, version/agent preflight, network/HTTP/timeout failure codes with
// no leakage, every SSE failure mode, and the chat visibility guarantees.

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runQwenPawAgent, QwenPawProviderError } from "../src/agent/qwenpawProvider.js";

const TMP = mkdtempSync(join(tmpdir(), "qwenpaw-provider-"));
const TASK = { task_type: "careband_elder_state_summary", elder_id: "E001" };
const RUN_ID = "run-1";
const SESSION_ID = `careband-runtime:${RUN_ID}`;
const DEFAULT_FINAL = "GLM-5.2 摘要";
const UUID_TITLE_RE = /^\[[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\]\[runtime\] CareBand Summary$/;
const AGENTS_OK = JSON.stringify({ agents: [{ agent_id: "careband_summary_agent", active_model: { provider_id: "zhipu-cn-codingplan", model: "glm-5.2" } }] });

// ---- helpers --------------------------------------------------------------

function portFile(port) {
  const p = join(TMP, `port-${port}-${Math.random().toString(36).slice(2, 8)}.txt`);
  writeFileSync(p, String(port), "utf8");
  return p;
}

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(""));
  });

const clone = (o) => JSON.parse(JSON.stringify(o));
const stop = (server) => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); });

function defaultSuccessFrames(finalText) {
  return [
    `data: ${JSON.stringify({ status: "streaming", output: [{ role: "assistant", text: "..." }] })}\n\n`,
    `data: ${JSON.stringify({ status: "completed", output: [{ role: "assistant", type: "message", status: "completed", text: finalText }] })}\n\n`,
    "data: [DONE]\n\n",
  ];
}

function startFake(overrides = {}) {
  const cfg = {
    finalText: DEFAULT_FINAL,
    versionStatus: 200, versionBody: JSON.stringify({ version: "2.0.1" }),
    agentsStatus: 200, agentsBody: AGENTS_OK,
    chatStatus: 200, listStatus: 200, detailStatus: 200, renameStatus: 200,
    sseFrames: null, hangPath: null, chatStore: new Map(), nextId: 1,
    listHook: null, detailHook: null, renameHook: null,
    ...overrides,
  };
  const log = [];
  let listCalls = 0;
  const json = (res, status, obj) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(typeof obj === "string" ? obj : JSON.stringify(obj));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const entry = { method: req.method, url: req.url, path: url.pathname, headers: { ...req.headers }, body: null };
    log.push(entry);
    let bodyText = null;
    if (req.method === "POST" || req.method === "PUT") {
      bodyText = await readBody(req);
      entry.body = bodyText;
    }
    if (cfg.hangPath && url.pathname === cfg.hangPath) return;
    let parsed = {};
    if (bodyText) {
      try { parsed = JSON.parse(bodyText); } catch { parsed = {}; }
    }

    if (req.method === "GET" && url.pathname === "/api/version") return json(res, cfg.versionStatus, cfg.versionBody);
    if (req.method === "GET" && url.pathname === "/api/agents") return json(res, cfg.agentsStatus, cfg.agentsBody);

    if (req.method === "POST" && url.pathname === "/api/console/chat") {
      if (cfg.chatStatus !== 200) return json(res, cfg.chatStatus, { error: "chat_failed" });
      const inputText = parsed.input?.[0]?.content?.[0]?.text ?? "";
      const chat = {
        id: String(cfg.nextId++),
        session_id: typeof parsed.session_id === "string" ? parsed.session_id : "",
        user_id: parsed.user_id, channel: parsed.channel, title: "Untitled",
        messages: [
          { role: "user", type: "message", content: [{ type: "text", text: inputText }] },
          { role: "assistant", type: "message", status: "completed", content: [{ type: "text", text: cfg.finalText }] },
        ],
      };
      cfg.chatStore.set(chat.id, chat);
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const frames = cfg.sseFrames ? cfg.sseFrames : defaultSuccessFrames(cfg.finalText);
      for (const f of frames) res.write(f);
      return res.end();
    }

    if (req.method === "GET" && url.pathname === "/api/chats") {
      listCalls++;
      if (cfg.listStatus !== 200) return json(res, cfg.listStatus, { error: "list_failed" });
      const uid = url.searchParams.get("user_id"), ch = url.searchParams.get("channel");
      let arr = [...cfg.chatStore.values()].filter((c) => (!uid || c.user_id === uid) && (!ch || c.channel === ch));
      if (typeof cfg.listHook === "function") arr = cfg.listHook(arr, listCalls);
      return json(res, 200, { chats: arr });
    }

    const m = url.pathname.match(/^\/api\/chats\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const chat = cfg.chatStore.get(id);
      if (req.method === "GET") {
        if (cfg.detailStatus !== 200) return json(res, cfg.detailStatus, { error: "detail_failed" });
        if (!chat) return json(res, 404, { error: "not_found" });
        let detail = clone(chat);
        if (typeof cfg.detailHook === "function") detail = cfg.detailHook(detail);
        return json(res, 200, detail);
      }
      if (req.method === "PUT") {
        if (cfg.renameStatus !== 200) return json(res, cfg.renameStatus, { error: "rename_failed" });
        if (!chat) return json(res, 404, { error: "not_found" });
        if (parsed && typeof parsed.name === "string") chat.title = parsed.name;
        if (typeof cfg.renameHook === "function") cfg.renameHook(chat, parsed && parsed.name);
        return json(res, 200, chat);
      }
    }
    json(res, 404, { error: "not_found" });
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, port, origin: `http://127.0.0.1:${port}`, cfg, log });
    });
  });
}

async function runWith(fake, opts = {}) {
  const ac = { portFile: portFile(fake.port), runId: opts.runId ?? RUN_ID, timeoutMs: opts.timeoutMs ?? 3000 };
  if (opts.maxResponseBytes !== undefined) ac.maxResponseBytes = opts.maxResponseBytes;
  if (opts.fetchImpl !== undefined) ac.fetchImpl = opts.fetchImpl;
  if (opts.agentId !== undefined) ac.agentId = opts.agentId;
  return runQwenPawAgent(TASK, ac);
}

async function expectReject(promise, code) {
  try {
    await promise;
    assert.fail(`expected rejection with ${code}, but resolved`);
  } catch (err) {
    assert.ok(err instanceof QwenPawProviderError, `not QwenPawProviderError: ${err && err.message}`);
    assert.equal(err.code, code, `wrong code: ${err.code}`);
    assert.equal(err.message, code, `message must equal code`);
    for (const bad of ["http://", "127.0.0.1", "8088", "desktop_port", ".qwenpaw", "Error:", SESSION_ID, JSON.stringify(TASK)]) {
      assert.ok(!err.message.includes(bad), `leak in message: ${err.message}`);
    }
  }
}

async function expectFakeCode(overrides, code, runOpts) {
  const fake = await startFake(overrides);
  try {
    await expectReject(runWith(fake, runOpts), code);
  } finally {
    await stop(fake.server);
  }
}

// ---- success --------------------------------------------------------------

test("success path returns the full provider trace", async () => {
  const fake = await startFake();
  try {
    const r = await runWith(fake);
    assert.equal(r.requested_provider, "qwenpaw");
    assert.equal(r.actual_provider, "qwenpaw");
    assert.equal(r.provider, "zhipu-cn-codingplan");
    assert.equal(r.model, "glm-5.2");
    assert.equal(r.agentId, "careband_summary_agent");
    assert.equal(r.sessionId, SESSION_ID);
    assert.equal(typeof r.chatId, "string");
    assert.ok(r.chatId.length > 0);
    assert.equal(r.responseText, DEFAULT_FINAL);
    assert.equal(r.fallback_used, false);
    assert.deepEqual(Object.keys(r).sort(), ["actual_provider", "agentId", "chatId", "fallback_used", "model", "provider", "requested_provider", "responseText", "sessionId"].sort());
  } finally {
    await stop(fake.server);
  }
});

test("exact preflight/POST/list/detail/rename shapes; POST happens exactly once", async () => {
  const fake = await startFake();
  try {
    await runWith(fake);
    const find = (method, re) => fake.log.find((e) => e.method === method && re.test(e.path));
    assert.equal(find("GET", /^\/api\/version$/).headers["x-agent-id"], "careband_summary_agent");
    assert.equal(find("GET", /^\/api\/agents$/).headers["x-agent-id"], "careband_summary_agent");
    const posts = fake.log.filter((e) => e.method === "POST" && e.path === "/api/console/chat");
    assert.equal(posts.length, 1, "POST /api/console/chat must happen exactly once");
    const body = JSON.parse(posts[0].body);
    assert.equal(posts[0].headers["accept"], "text/event-stream");
    assert.equal(posts[0].headers["content-type"], "application/json");
    assert.equal(body.agent_id, undefined);
    assert.equal(body.session_id, SESSION_ID);
    assert.equal(body.user_id, "careband-backend");
    assert.equal(body.channel, "console");
    assert.equal(body.stream, true);
    assert.deepEqual(body.input, [{ role: "user", content: [{ type: "text", text: JSON.stringify(TASK) }] }]);
    const lists = fake.log.filter((e) => e.method === "GET" && e.path === "/api/chats");
    assert.ok(lists[0].url.includes("user_id=careband-backend") && lists[0].url.includes("channel=console"));
    assert.equal(lists[0].headers["x-agent-id"], "careband_summary_agent");
    assert.ok(find("GET", /^\/api\/chats\/[^/]+$/), "detail GET recorded");
    const put = find("PUT", /^\/api\/chats\/[^/]+$/);
    assert.equal(put.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(put.body), { name: "[run-1][runtime] CareBand Summary" });
  } finally {
    await stop(fake.server);
  }
});

test("dynamic port is honoured; legacy 8088 is never used", async () => {
  const fake = await startFake();
  try {
    assert.notEqual(fake.port, 8088);
    const r = await runWith(fake);
    assert.equal(r.responseText, DEFAULT_FINAL);
    assert.ok(fake.log.length > 0);
  } finally {
    await stop(fake.server);
  }
});

test("runId defaults to a UUID and drives the rename title", async () => {
  const fake = await startFake();
  try {
    const r = await runQwenPawAgent(TASK, { portFile: portFile(fake.port), timeoutMs: 3000 });
    const uuid = r.sessionId.slice("careband-runtime:".length);
    assert.ok(UUID_TITLE_RE.test(`[${uuid}][runtime] CareBand Summary`), `unexpected uuid: ${uuid}`);
    const put = fake.log.find((e) => e.method === "PUT");
    assert.ok(UUID_TITLE_RE.test(JSON.parse(put.body).name), "rename title must wrap a uuid");
  } finally {
    await stop(fake.server);
  }
});

test("runId accepts dots, underscores and dashes", () =>
  startFake().then(async (fake) => {
    try {
      const r = await runWith(fake, { runId: "r.un_1-x" });
      assert.equal(r.sessionId, "careband-runtime:r.un_1-x");
    } finally {
      await stop(fake.server);
    }
  }));

test("fetchImpl injection is used for every request", () =>
  startFake().then(async (fake) => {
    try {
      let calls = 0;
      const fetchImpl = async (url, init) => { calls++; return globalThis.fetch(url, init); };
      await runWith(fake, { fetchImpl });
      assert.ok(calls >= 7, `expected >=7 injected calls, got ${calls}`);
    } finally {
      await stop(fake.server);
    }
  }));

// ---- config validation ----------------------------------------------------

test("invalid port file content -> QWENPAW_CONFIG_INVALID", async () => {
  for (const bad of ["", "abc", "0", "65536", "70000", "-1", "12.5", "8088", "8088x", "  ", "1e3"]) {
    const pf = join(TMP, `bad-${Math.random().toString(36).slice(2)}.txt`);
    writeFileSync(pf, bad, "utf8");
    await expectReject(runQwenPawAgent(TASK, { portFile: pf, runId: RUN_ID }), "QWENPAW_CONFIG_INVALID");
  }
});

test("a trimmed valid port inside the file is accepted", async () => {
  const fake = await startFake();
  try {
    const pf = join(TMP, `ok-${Math.random().toString(36).slice(2)}.txt`);
    writeFileSync(pf, ` ${fake.port} \n`, "utf8");
    assert.equal((await runQwenPawAgent(TASK, { portFile: pf, runId: RUN_ID, timeoutMs: 3000 })).responseText, DEFAULT_FINAL);
  } finally {
    await stop(fake.server);
  }
});

test("invalid timeout/runId/maxResponseBytes/agentId/fetchImpl -> QWENPAW_CONFIG_INVALID", async () => {
  const pf = portFile(1);
  for (const opts of [
    { timeoutMs: 0 }, { timeoutMs: -5 }, { timeoutMs: 1.5 }, { timeoutMs: "30" },
    { maxResponseBytes: 0 }, { maxResponseBytes: -1 }, { maxResponseBytes: 2.5 },
    { runId: "" }, { runId: "bad run" }, { runId: "a/b" }, { runId: "a".repeat(129) },
    { agentId: "" }, { agentId: 123 }, { agentId: "other" }, { fetchImpl: "nope" },
  ]) {
    await expectReject(runQwenPawAgent(TASK, { portFile: pf, runId: RUN_ID, ...opts }), "QWENPAW_CONFIG_INVALID");
  }
});

test("missing task -> QWENPAW_CONFIG_INVALID", () =>
  expectReject(runQwenPawAgent(undefined, { portFile: portFile(1) }), "QWENPAW_CONFIG_INVALID"));

// ---- version / agent preflight -------------------------------------------

test("unsupported version -> QWENPAW_VERSION_UNSUPPORTED", () =>
  expectFakeCode({ versionBody: JSON.stringify({ version: "2.0.0" }) }, "QWENPAW_VERSION_UNSUPPORTED"));

test("version malformed JSON -> QWENPAW_VERSION_UNSUPPORTED", () =>
  expectFakeCode({ versionBody: "not-json" }, "QWENPAW_VERSION_UNSUPPORTED"));

test("agent not found -> QWENPAW_AGENT_NOT_READY", () =>
  expectFakeCode({ agentsBody: JSON.stringify({ agents: [{ agent_id: "other", active_model: { provider_id: "zhipu-cn-codingplan", model: "glm-5.2" } }] }) }, "QWENPAW_AGENT_NOT_READY"));

test("agent model mismatch -> QWENPAW_AGENT_NOT_READY", () =>
  expectFakeCode({ agentsBody: JSON.stringify({ agents: [{ agent_id: "careband_summary_agent", active_model: { provider_id: "zhipu-cn-codingplan", model: "gpt-4" } }] }) }, "QWENPAW_AGENT_NOT_READY"));

test("agent provider mismatch -> QWENPAW_AGENT_NOT_READY", () =>
  expectFakeCode({ agentsBody: JSON.stringify({ agents: [{ agent_id: "careband_summary_agent", active_model: { provider_id: "other", model: "glm-5.2" } }] }) }, "QWENPAW_AGENT_NOT_READY"));

// ---- network / HTTP / timeout --------------------------------------------

test("connection refused -> QWENPAW_UNAVAILABLE", async () => {
  const fake = await startFake();
  const port = fake.port;
  await stop(fake.server);
  await expectReject(runQwenPawAgent(TASK, { portFile: portFile(port), runId: RUN_ID, timeoutMs: 2000 }), "QWENPAW_UNAVAILABLE");
});

test("preflight HTTP 500 -> QWENPAW_HTTP_ERROR", () => expectFakeCode({ versionStatus: 500 }, "QWENPAW_HTTP_ERROR"));
test("chat POST HTTP 500 -> QWENPAW_HTTP_ERROR", () => expectFakeCode({ chatStatus: 500 }, "QWENPAW_HTTP_ERROR"));
test("preflight timeout -> QWENPAW_TIMEOUT", () => expectFakeCode({ hangPath: "/api/version" }, "QWENPAW_TIMEOUT", { timeoutMs: 300 }));
test("chat stream timeout -> QWENPAW_TIMEOUT", () => expectFakeCode({ hangPath: "/api/console/chat" }, "QWENPAW_TIMEOUT", { timeoutMs: 300 }));

// ---- SSE failure modes ----------------------------------------------------

test("SSE reassembles multi-byte UTF-8 split across chunks", async () => {
  const finalText = "摘要 GLM-5.2 结果";
  const frames = defaultSuccessFrames(finalText);
  const completed = Buffer.from(frames[1], "utf8");
  const marker = '"text":"';
  const cut = completed.indexOf(Buffer.from(marker, "utf8")) + Buffer.byteLength(marker, "utf8") + 1;
  const fake = await startFake({ finalText, sseFrames: [frames[0], completed.subarray(0, cut), completed.subarray(cut), frames[2]] });
  try {
    assert.equal((await runWith(fake)).responseText, finalText);
  } finally {
    await stop(fake.server);
  }
});

test("non-terminal completed frame without [DONE] -> QWENPAW_SSE_INVALID", () =>
  expectFakeCode({ sseFrames: defaultSuccessFrames(DEFAULT_FINAL).slice(0, 2) }, "QWENPAW_SSE_INVALID"));

test("Desktop 2.0.1 terminal response completes without [DONE]", () => {
  const terminal = {
    object: "response", status: "completed",
    output: [{ object: "message", role: "assistant", status: "completed", content: [{ type: "text", text: DEFAULT_FINAL }] }],
  };
  return startFake({
    sseFrames: [
      `data: ${JSON.stringify({ object: "response", status: "created", output: [] })}\n\n`,
      `data: ${JSON.stringify({ object: "response", status: "in_progress", output: [] })}\n\n`,
      `data: ${JSON.stringify(terminal)}\n\n`,
      `data: ${JSON.stringify({ object: "turn_usage", input_tokens: 1, output_tokens: 1 })}\n\n`,
    ],
  }).then(async (fake) => {
    try { assert.equal((await runWith(fake)).responseText, DEFAULT_FINAL); }
    finally { await stop(fake.server); }
  });
});

test("SSE malformed JSON frame -> QWENPAW_SSE_INVALID", () =>
  expectFakeCode({ sseFrames: ["data: {not valid json\n\n", "data: [DONE]\n\n"] }, "QWENPAW_SSE_INVALID"));

test("SSE oversize response -> QWENPAW_RESPONSE_TOO_LARGE", () =>
  expectFakeCode({ sseFrames: [`data: ${"x".repeat(5000)}\n\n`] }, "QWENPAW_RESPONSE_TOO_LARGE", { maxResponseBytes: 64 }));

test("SSE remote failed status -> QWENPAW_REMOTE_FAILED", () =>
  expectFakeCode({ sseFrames: [`data: ${JSON.stringify({ status: "failed", output: [] })}\n\n`, "data: [DONE]\n\n"] }, "QWENPAW_REMOTE_FAILED"));

test("SSE tool_call frame -> QWENPAW_TOOL_ACTIVITY", () =>
  expectFakeCode({ sseFrames: [`data: ${JSON.stringify({ status: "completed", output: [{ role: "assistant", type: "tool_call", text: "x" }] })}\n\n`, "data: [DONE]\n\n"] }, "QWENPAW_TOOL_ACTIVITY"));

test("SSE plugin_call_output frame -> QWENPAW_TOOL_ACTIVITY", () =>
  expectFakeCode({ sseFrames: [`data: ${JSON.stringify({ status: "streaming", output: [{ object: "plugin_call_output", text: "y" }] })}\n\n`, "data: [DONE]\n\n"] }, "QWENPAW_TOOL_ACTIVITY"));

test("SSE completed but empty final text -> QWENPAW_FINAL_MISSING", () =>
  expectFakeCode({ sseFrames: [`data: ${JSON.stringify({ status: "completed", output: [{ role: "assistant", type: "message", status: "completed", text: "" }] })}\n\n`, "data: [DONE]\n\n"] }, "QWENPAW_FINAL_MISSING"));

test("SSE never reaches a completed frame -> QWENPAW_FINAL_MISSING", () =>
  expectFakeCode({ sseFrames: [`data: ${JSON.stringify({ status: "streaming", output: [{ role: "assistant", text: "partial" }] })}\n\n`, "data: [DONE]\n\n"] }, "QWENPAW_FINAL_MISSING"));

// ---- chat visibility ------------------------------------------------------

test("chat missing from list -> QWENPAW_CHAT_NOT_VISIBLE", () =>
  expectFakeCode({ listHook: () => [] }, "QWENPAW_CHAT_NOT_VISIBLE"));

test("multiple chats with the same session_id -> QWENPAW_CHAT_NOT_VISIBLE", () =>
  expectFakeCode({ listHook: () => [{ id: "a", session_id: SESSION_ID }, { id: "b", session_id: SESSION_ID }] }, "QWENPAW_CHAT_NOT_VISIBLE"));

test("detail assistant text differs from SSE -> QWENPAW_CHAT_NOT_VISIBLE", () =>
  expectFakeCode({
    detailHook: (c) => ({ ...c, messages: [{ role: "user", type: "message", text: JSON.stringify(TASK) }, { role: "assistant", type: "message", status: "completed", text: "DIFFERENT" }] }),
  }, "QWENPAW_CHAT_NOT_VISIBLE"));

test("detail user text differs from request -> QWENPAW_CHAT_NOT_VISIBLE", () =>
  expectFakeCode({
    detailHook: (c) => ({ ...c, messages: [{ role: "user", type: "message", text: "not-the-task" }, { role: "assistant", type: "message", status: "completed", text: DEFAULT_FINAL }] }),
  }, "QWENPAW_CHAT_NOT_VISIBLE"));

test("identity mismatch after rename -> QWENPAW_CHAT_NOT_VISIBLE", () =>
  expectFakeCode({ listHook: (chats, n) => (n >= 2 ? chats.map((c) => ({ ...c, session_id: "careband-runtime:other" })) : chats) }, "QWENPAW_CHAT_NOT_VISIBLE"));

test("detail HTTP error -> QWENPAW_HTTP_ERROR", () => expectFakeCode({ detailStatus: 500 }, "QWENPAW_HTTP_ERROR"));
