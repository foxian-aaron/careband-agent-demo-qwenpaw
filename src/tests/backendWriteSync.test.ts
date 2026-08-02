// src/tests/backendWriteSync.test.ts — Stage 6C write client coverage.
// Verifies exact URL/method/content-type/JSON body for POST /api/events and
// PATCH /api/tasks/:id, that static preview (null base) never fetches, and that
// every failure type (http / non-JSON / bad JSON / ok=false / network / timeout)
// yields a fixed sanitized error that never leaks body, URL, host or stack.

import { describe, expect, it, vi } from "vitest";
import { patchTask, postAgentAnalyze, postEvent } from "../lib/apiClient";
import {
  createInitialDemoState,
  demoReducer,
  executeConnectedAction,
  type ConnectedActionDeps,
  type DemoAction,
  type DemoState,
} from "../store/demoStore";
import type { BackendSyncPayload } from "../types";

type FetchImpl = typeof fetch;

// --- fixtures ---------------------------------------------------------------
const jsonRes = (body: unknown, status = 200, type = "application/json"): FetchImpl => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": type } }));
const hanging = (): FetchImpl => (_i, init) =>
  new Promise((_r, rej) =>
    init?.signal?.addEventListener("abort", () => {
      const e = new Error("aborted");
      e.name = "AbortError";
      rej(e);
    }),
  );

/** Capturing fetch impl that records the request url + init, then delegates. */
const capture =
  (sink: { url: string; init: RequestInit | undefined }, next: FetchImpl): FetchImpl =>
  (input, init) => {
    sink.url = String(input);
    sink.init = init;
    return next(input, init);
  };

// --- A. request shape -------------------------------------------------------
describe("postEvent request shape", () => {
  it("POSTs exactly {base}/api/events with content-type application/json and the caller body", async () => {
    const sink = { url: "", init: undefined as RequestInit | undefined };
    const body = { event_type: "sos", elder_id: "E001", payload: { note: "n" } };
    const r = await postEvent(body, {
      baseUrl: "http://api.example",
      fetchImpl: capture(sink, jsonRes({ ok: true })),
    });
    expect(r.status).toBe("ok");
    expect(sink.url).toBe("http://api.example/api/events");
    expect(sink.init?.method).toBe("POST");
    expect(sink.init?.headers).toMatchObject({
      "content-type": "application/json",
      accept: "application/json",
    });
    expect(JSON.parse(sink.init?.body as string)).toEqual(body);
  });

  it("local same-origin base ('') POSTs exactly /api/events", async () => {
    const sink = { url: "", init: undefined as RequestInit | undefined };
    await postEvent({}, { baseUrl: "", fetchImpl: capture(sink, jsonRes({ ok: true })) });
    expect(sink.url).toBe("/api/events");
  });
});

describe("patchTask request shape", () => {
  it("PATCHes exactly {base}/api/tasks/:id with content-type application/json and body {status}", async () => {
    const sink = { url: "", init: undefined as RequestInit | undefined };
    const r = await patchTask("T-001", { status: "completed" }, {
      baseUrl: "http://api.example",
      fetchImpl: capture(sink, jsonRes({ ok: true })),
    });
    expect(r.status).toBe("ok");
    expect(sink.url).toBe("http://api.example/api/tasks/T-001");
    expect(sink.init?.method).toBe("PATCH");
    expect(sink.init?.headers).toMatchObject({
      "content-type": "application/json",
      accept: "application/json",
    });
    expect(JSON.parse(sink.init?.body as string)).toEqual({ status: "completed" });
  });

  it("URL-encodes the task id into the path segment", async () => {
    const sink = { url: "", init: undefined as RequestInit | undefined };
    await patchTask("a/b c", { status: "in_progress" }, {
      baseUrl: "http://x",
      fetchImpl: capture(sink, jsonRes({ ok: true })),
    });
    expect(sink.url).toBe("http://x/api/tasks/a%2Fb%20c");
  });
});

describe("postAgentAnalyze request shape", () => {
  it("POSTs identity/linkage only and never accepts client risk or provider fields", async () => {
    const sink = { url: "", init: undefined as RequestInit | undefined };
    const result = await postAgentAnalyze("E001", {
      sourceEventId: 17,
      baseUrl: "",
      fetchImpl: capture(sink, jsonRes({ ok: true }, 201)),
    });
    expect(result.status).toBe("ok");
    expect(sink.url).toBe("/api/agent/analyze");
    expect(sink.init?.method).toBe("POST");
    expect(JSON.parse(sink.init?.body as string)).toEqual({ elder_id: "E001", source_event_id: 17 });
    expect(sink.init?.body).not.toMatch(/status_level|risk_score|provider|model/);
  });

  it("uses a dedicated 70-second Agent timeout instead of the 6-second write timeout", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    try {
      const pending = postAgentAnalyze("E001", {
        baseUrl: "",
        fetchImpl: (_input, init) => new Promise((_resolve, reject) => {
          signal = init?.signal ?? undefined;
          signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
      });
      await vi.advanceTimersByTimeAsync(6_000);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(64_000);
      expect(signal?.aborted).toBe(true);
      const result = await pending;
      expect(result.status).toBe("error");
      if (result.status === "error") expect(result.error.code).toBe("timeout");
    } finally {
      vi.useRealTimers();
    }
  });
});

// --- B. static preview never fetches ---------------------------------------
describe("static preview (null base) never fetches", () => {
  it("postEvent returns static_preview error without calling fetch", async () => {
    let called = false;
    const r = await postEvent({ event_type: "sos" }, {
      baseUrl: null,
      fetchImpl: () => {
        called = true;
        return Promise.resolve(new Response(""));
      },
    });
    expect(called).toBe(false);
    expect(r.status).toBe("error");
    if (r.status === "error") expect(r.error.code).toBe("static_preview");
  });

  it("patchTask returns static_preview error without calling fetch", async () => {
    let called = false;
    const r = await patchTask("T1", { status: "completed" }, {
      baseUrl: null,
      fetchImpl: () => {
        called = true;
        return Promise.resolve(new Response(""));
      },
    });
    expect(called).toBe(false);
    expect(r.status).toBe("error");
    if (r.status === "error") expect(r.error.code).toBe("static_preview");
  });

  it("postAgentAnalyze returns static_preview without calling fetch", async () => {
    let called = false;
    const result = await postAgentAnalyze("E001", {
      baseUrl: null,
      fetchImpl: () => { called = true; return Promise.resolve(new Response("")); },
    });
    expect(called).toBe(false);
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.error.code).toBe("static_preview");
  });
});

// --- C. failure classification & sanitization (postEvent) ------------------
describe("postEvent failure classification & sanitization", () => {
  it("http error: http_error with status, body never leaked", async () => {
    const r = await postEvent({}, { baseUrl: "http://x", fetchImpl: jsonRes({ leak: "SECRET-BODY" }, 500) });
    expect(r.status).toBe("error");
    if (r.status === "error") {
      expect(r.error.code).toBe("http_error");
      expect(r.error.status).toBe(500);
      expect(JSON.stringify(r.error)).not.toContain("SECRET-BODY");
    }
  });

  it("non-JSON content-type: bad_content_type, html never leaked", async () => {
    const r = await postEvent({}, {
      baseUrl: "http://x",
      fetchImpl: () =>
        Promise.resolve(new Response("<html>SECRET-HTML</html>", { status: 200, headers: { "content-type": "text/html" } })),
    });
    expect(r.status).toBe("error");
    if (r.status === "error") {
      expect(r.error.code).toBe("bad_content_type");
      expect(JSON.stringify(r.error)).not.toContain("SECRET-HTML");
    }
  });

  it("unparseable JSON body: bad_json", async () => {
    const r = await postEvent({}, {
      baseUrl: "http://x",
      fetchImpl: () =>
        Promise.resolve(new Response("{not valid json", { status: 200, headers: { "content-type": "application/json" } })),
    });
    expect(r.status).toBe("error");
    if (r.status === "error") expect(r.error.code).toBe("bad_json");
  });

  it("ok===false: invalid_payload, response fields never leaked", async () => {
    const r = await postEvent({}, { baseUrl: "http://x", fetchImpl: jsonRes({ ok: false, detail: "SECRET" }) });
    expect(r.status).toBe("error");
    if (r.status === "error") {
      expect(r.error.code).toBe("invalid_payload");
      expect(JSON.stringify(r.error)).not.toContain("SECRET");
    }
  });

  it("network error: network, no host/path/stack/exception leaked", async () => {
    const r = await postEvent({}, {
      baseUrl: "http://127.0.0.1:3001",
      fetchImpl: () => Promise.reject(new Error("ECONNREFUSED 127.0.0.1:3001\n    at secret (stack.js:1:1)")),
    });
    expect(r.status).toBe("error");
    if (r.status === "error") {
      expect(r.error.code).toBe("network");
      expect(JSON.stringify(r.error)).not.toContain("ECONNREFUSED");
      expect(JSON.stringify(r.error)).not.toContain("127.0.0.1");
      expect(JSON.stringify(r.error)).not.toContain("stack");
      expect(JSON.stringify(r.error)).not.toContain("secret");
    }
  });

  it("timeout: timeout, no host/path/abort leaked", async () => {
    const r = await postEvent({}, { baseUrl: "http://127.0.0.1:3001", fetchImpl: hanging(), timeoutMs: 40 });
    expect(r.status).toBe("error");
    if (r.status === "error") {
      expect(r.error.code).toBe("timeout");
      expect(JSON.stringify(r.error)).not.toContain("127.0.0.1");
      expect(JSON.stringify(r.error)).not.toContain("aborted");
    }
  });
});

// --- D. patchTask shares the same safe pipeline ----------------------------
describe("patchTask failure classification (shared pipeline)", () => {
  it.each<[string, FetchImpl, string]>([
    ["http_error", jsonRes({ leak: "SECRET" }, 500), "http_error"],
    [
      "bad_content_type",
      () =>
        Promise.resolve(new Response("<html>SECRET</html>", { status: 200, headers: { "content-type": "text/html" } })),
      "bad_content_type",
    ],
    [
      "bad_json",
      () =>
        Promise.resolve(new Response("{bad", { status: 200, headers: { "content-type": "application/json" } })),
      "bad_json",
    ],
    ["invalid_payload", jsonRes({ ok: false, leak: "SECRET" }), "invalid_payload"],
  ])("classifies %s without leaking body", async (_label, impl, code) => {
    const r = await patchTask("T1", { status: "completed" }, { baseUrl: "http://x", fetchImpl: impl });
    expect(r.status).toBe("error");
    if (r.status === "error") {
      expect(r.error.code).toBe(code);
      expect(JSON.stringify(r.error)).not.toContain("SECRET");
    }
  });

  it("network: sanitized, no host/exception leaked", async () => {
    const r = await patchTask("T1", { status: "completed" }, {
      baseUrl: "http://127.0.0.1:3001",
      fetchImpl: () => Promise.reject(new Error("ECONNREFUSED 127.0.0.1:3001")),
    });
    expect(r.status).toBe("error");
    if (r.status === "error") {
      expect(r.error.code).toBe("network");
      expect(JSON.stringify(r.error)).not.toContain("ECONNREFUSED");
      expect(JSON.stringify(r.error)).not.toContain("127.0.0.1");
    }
  });
});

// --- E. success requires ok===true only ------------------------------------
describe("success contract", () => {
  it("postEvent ok only when http 200 + json + ok===true", async () => {
    const r = await postEvent({}, { baseUrl: "http://x", fetchImpl: jsonRes({ ok: true }) });
    expect(r.status).toBe("ok");
  });
  it("patchTask ok only when http 200 + json + ok===true", async () => {
    const r = await patchTask("T1", { status: "completed" }, { baseUrl: "http://x", fetchImpl: jsonRes({ ok: true }) });
    expect(r.status).toBe("ok");
  });
});

// --- F. connected Store orchestration -------------------------------------
const connectedState = (status: "pending" | "in_progress" = "pending"): DemoState => {
  const initial = createInitialDemoState();
  const task = initial.tasks[0];
  if (!task) throw new Error("fixture task missing");
  return {
    ...initial,
    backend: {
      status: "connected",
      mode: "backend",
      lastSyncedAt: "2026-08-01T12:00:00.000Z",
      error: null,
      readOnlyNotice: null,
    },
    tasks: [{ ...task, taskId: "TASK-SRV-42", elderId: "E001", status }],
  };
};

const orchestrationDeps = (overrides: Partial<ConnectedActionDeps> = {}): ConnectedActionDeps => ({
  postEvent: vi.fn().mockResolvedValue({ status: "ok", data: { ok: true } }) as ConnectedActionDeps["postEvent"],
  patchTask: vi.fn().mockResolvedValue({ status: "ok", data: { ok: true } }) as ConnectedActionDeps["patchTask"],
  postAgentAnalyze: vi.fn().mockResolvedValue({ status: "ok" }) as ConnectedActionDeps["postAgentAnalyze"],
  fetchDashboard: vi.fn().mockResolvedValue({ status: "connected", data: { ok: true } }) as ConnectedActionDeps["fetchDashboard"],
  mapDashboard: vi.fn().mockReturnValue({ generatedAt: "refreshed" } as BackendSyncPayload),
  ...overrides,
});

describe("connected Store write orchestration", () => {
  it("submits the exact software SOS contract, refreshes, and dispatches server data", async () => {
    const deps = orchestrationDeps();
    const actions: DemoAction[] = [];
    await executeConnectedAction(connectedState(), { type: "TRIGGER_SOS" }, (a) => actions.push(a), { current: false }, deps);
    expect(deps.postEvent).toHaveBeenCalledWith({
      elder_id: "E001",
      event_type: "sos",
      source: "software_simulator",
      payload: {},
    });
    expect(deps.fetchDashboard).toHaveBeenCalledOnce();
    expect(deps.postAgentAnalyze).toHaveBeenCalledWith("E001");
    expect(actions).toEqual([{ type: "BACKEND_CONNECTED", payload: { generatedAt: "refreshed" } }]);
  });

  it.each([
    ["CAREGIVER_ACCEPT_TASK", "in_progress"],
    ["COMPLETE_CARE_TASK", "resolved"],
  ] as const)("maps %s to the numeric server task id and status %s", async (type, status) => {
    const deps = orchestrationDeps();
    await executeConnectedAction(connectedState(type === "COMPLETE_CARE_TASK" ? "in_progress" : "pending"), { type }, vi.fn(), { current: false }, deps);
    expect(deps.patchTask).toHaveBeenCalledWith("42", { status });
    expect(deps.fetchDashboard).toHaveBeenCalledOnce();
    expect(deps.postAgentAnalyze).toHaveBeenCalledWith("E001");
  });

  it("keeps the successful business write and refreshed dashboard when Agent transport fails", async () => {
    const deps = orchestrationDeps({
      postAgentAnalyze: vi.fn().mockResolvedValue({ status: "error", error: { code: "network", message: "Agent 暂不可用" } }) as ConnectedActionDeps["postAgentAnalyze"],
      mapDashboard: vi.fn().mockReturnValue({
        generatedAt: "refreshed",
        agentSummaries: { E001: { caregiverSummary: "stale" } },
      } as unknown as BackendSyncPayload),
    });
    const actions: DemoAction[] = [];
    await executeConnectedAction(connectedState(), { type: "TRIGGER_SOS" }, (action) => actions.push(action), { current: false }, deps);
    expect(actions).toEqual([
      { type: "BACKEND_CONNECTED", payload: { generatedAt: "refreshed", agentSummaries: {} } },
      { type: "BACKEND_WRITE_FAILED", error: { code: "network", message: "Agent 暂不可用" } },
    ]);
  });

  it("preserves server state and stops when the write fails", async () => {
    const deps = orchestrationDeps({
      postEvent: vi.fn().mockResolvedValue({ status: "error", error: { code: "network", message: "网络请求失败" } }) as ConnectedActionDeps["postEvent"],
    });
    const actions: DemoAction[] = [];
    await executeConnectedAction(connectedState(), { type: "TRIGGER_SOS" }, (a) => actions.push(a), { current: false }, deps);
    expect(deps.fetchDashboard).not.toHaveBeenCalled();
    expect(deps.postAgentAnalyze).not.toHaveBeenCalled();
    expect(actions).toEqual([{ type: "BACKEND_WRITE_FAILED", error: { code: "network", message: "网络请求失败" } }]);
  });

  it("the write-failure reducer preserves server-rendered business data", () => {
    const state = connectedState();
    const next = demoReducer(state, {
      type: "BACKEND_WRITE_FAILED",
      error: { code: "network", message: "网络请求失败" },
    });
    expect(next.tasks).toBe(state.tasks);
    expect(next.events).toBe(state.events);
    expect(next.serverData).toBe(state.serverData);
    expect(next.backend.mode).toBe("backend");
    expect(next.backend.error?.code).toBe("network");
  });

  it("reports refresh and mapping failures without replacing data", async () => {
    const refreshDeps = orchestrationDeps({
      fetchDashboard: vi.fn().mockResolvedValue({ status: "mock", error: { code: "network", message: "刷新失败" } }) as ConnectedActionDeps["fetchDashboard"],
    });
    const refreshActions: DemoAction[] = [];
    await executeConnectedAction(connectedState(), { type: "TRIGGER_SOS" }, (a) => refreshActions.push(a), { current: false }, refreshDeps);
    expect(refreshActions[0]?.type).toBe("BACKEND_WRITE_FAILED");

    const mapDeps = orchestrationDeps({ mapDashboard: () => { throw new Error("bad payload"); } });
    const mapActions: DemoAction[] = [];
    await executeConnectedAction(connectedState(), { type: "TRIGGER_SOS" }, (a) => mapActions.push(a), { current: false }, mapDeps);
    expect(mapActions).toEqual([{ type: "BACKEND_WRITE_FAILED", error: { code: "invalid_payload", message: "服务端刷新结果无效，请稍后重试" } }]);
  });

  it("never calls write APIs in mock mode, for blocked actions, or while another write is active", async () => {
    const deps = orchestrationDeps();
    expect(await executeConnectedAction(createInitialDemoState(), { type: "TRIGGER_SOS" }, vi.fn(), { current: false }, deps)).toBe(false);
    const blocked = vi.fn();
    await executeConnectedAction(connectedState(), { type: "RESET_DEMO" }, blocked, { current: false }, deps);
    const busy = vi.fn();
    await executeConnectedAction(connectedState(), { type: "TRIGGER_SOS" }, busy, { current: true }, deps);
    expect(deps.postEvent).not.toHaveBeenCalled();
    expect(deps.patchTask).not.toHaveBeenCalled();
    expect(blocked).toHaveBeenCalledWith(expect.objectContaining({ type: "BACKEND_WRITE_BLOCKED" }));
    expect(busy).toHaveBeenCalledWith(expect.objectContaining({ type: "BACKEND_WRITE_BLOCKED" }));
  });
});
