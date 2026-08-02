import { describe, expect, it, vi } from "vitest";
import {
  SIMULATOR_SCENARIOS,
  SOFTWARE_SIMULATOR_SOURCE,
  agentExerciseStatus,
  buildSimulatorRequest,
  submitSimulatorEvent,
} from "../lib/eventSimulator";

const jsonResponse = (body: unknown, status = 201): typeof fetch => () =>
  Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  }));
const sequentialJson = (responses: Array<{ body: unknown; status?: number }>): typeof fetch => {
  let index = 0;
  return () => {
    const next = responses[index++];
    if (!next) throw new Error("unexpected fetch");
    return Promise.resolve(new Response(JSON.stringify(next.body), {
      status: next.status ?? 201,
      headers: { "content-type": "application/json" },
    }));
  };
};

const eventSuccess = (request: ReturnType<typeof buildSimulatorRequest>) => ({
  ok: true,
  event: { event_id: 7, ...request, status: "active" },
  risk_result: {
    elder_id: request.elder_id,
    status_level: "urgent",
    risk_score: 100,
    key_reasons: ["检测到活跃 SOS 求救信号"],
    recommended_action: "立即联系老人核实情况",
    safety_disclaimer: "本结果仅为照护风险提示，不构成医疗诊断。",
  },
  task: {
    task_id: 9,
    elder_id: request.elder_id,
    status: "open",
    risk_level: "urgent",
    recommended_action: "立即联系老人核实情况",
  },
});

const agentSuccess = (fallback = false) => ({
  ok: true,
  agent_result: {
    status_level: "urgent",
    risk_score: 100,
    key_reasons: ["检测到活跃 SOS 求救信号"],
    recommended_action: "立即联系老人核实情况",
    caregiver_summary: "护工摘要",
    family_summary: "家属摘要",
    institution_summary: "机构摘要",
    safety_disclaimer: "本结果仅为照护风险提示，不构成医疗诊断。",
  },
  meta: fallback ? {
    requested_provider: "qwenpaw", actual_provider: "mock", provider: "deterministic-mock",
    model: "deterministic-mock-v0.3", fallback_used: true, validation_status: "fallback_valid",
  } : {
    requested_provider: "qwenpaw", actual_provider: "qwenpaw", provider: "zhipu-cn-codingplan",
    model: "glm-5.2", fallback_used: false, validation_status: "valid",
  },
});

describe("software event simulator contract", () => {
  it("builds all seven scenarios with the fixed source and no client risk or privacy fields", () => {
    expect(SIMULATOR_SCENARIOS).toHaveLength(7);
    for (const scenario of SIMULATOR_SCENARIOS) {
      const request = buildSimulatorRequest(scenario.id, "E001", "2026-08-02T01:02:03Z");
      const serialized = JSON.stringify(request);
      expect(request.source).toBe(SOFTWARE_SIMULATOR_SOURCE);
      expect(request.occurred_at).toBe("2026-08-02T01:02:03.000Z");
      expect(serialized).not.toMatch(/status_level|risk_score|key_reasons|recommended_action/);
      expect(serialized).not.toMatch(/raw_text|transcript|audio|latitude|longitude|coordinates|address/);
    }
  });

  it("uses structured dizziness and coarse zone data only", () => {
    expect(buildSimulatorRequest("dizziness", "E001", "2026-08-02T01:02:03Z").payload)
      .toEqual({ symptom_keywords: ["dizziness"] });
    expect(buildSimulatorRequest("safe_zone_exit", "E001", "2026-08-02T01:02:03Z").payload)
      .toEqual({ event_kind: "geofence_exit", zone_label: "安全区外" });
  });

  it("fails closed in static preview without fetching", async () => {
    let called = false;
    const request = buildSimulatorRequest("sos", "E001", "2026-08-02T01:02:03Z");
    const result = await submitSimulatorEvent(request, {
      baseUrl: null,
      fetchImpl: () => {
        called = true;
        return Promise.resolve(new Response(""));
      },
    });
    expect(called).toBe(false);
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.error.code).toBe("static_preview");
  });

  it("accepts and sanitizes a server-authoritative event trace", async () => {
    const request = buildSimulatorRequest("sos", "E001", "2026-08-02T01:02:03Z");
    const result = await submitSimulatorEvent(request, {
      baseUrl: "",
      fetchImpl: sequentialJson([
        { body: { ...eventSuccess(request), ignored: "not copied" } },
        { body: agentSuccess() },
      ]),
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.http_status).toBe(201);
      expect(result.data.event.source).toBe("software_simulator");
      expect(result.data.risk_result.status_level).toBe("urgent");
      expect(result.data.task?.task_id).toBe(9);
      expect(result.data.agent_status).toMatchObject({
        state: "qwenpaw_success", actual_provider: "qwenpaw", model: "glm-5.2", fallback_used: false,
      });
      expect(JSON.stringify(result.data)).not.toContain("ignored");
    }
  });

  it("keeps the authoritative event/risk/task trace when Agent transport fails", async () => {
    const request = buildSimulatorRequest("sos", "E001", "2026-08-02T01:02:03Z");
    const result = await submitSimulatorEvent(request, {
      baseUrl: "",
      fetchImpl: sequentialJson([
        { body: eventSuccess(request) },
        { body: { ok: false, error: "SECRET" }, status: 503 },
      ]),
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.risk_result.status_level).toBe("urgent");
      expect(result.data.agent_status).toEqual(expect.objectContaining({ state: "error", error_code: "http_error" }));
      expect(JSON.stringify(result.data.agent_status)).not.toContain("SECRET");
    }
  });

  it("labels a validated deterministic Agent fallback explicitly", async () => {
    const request = buildSimulatorRequest("sos", "E001", "2026-08-02T01:02:03Z");
    const result = await submitSimulatorEvent(request, {
      baseUrl: "",
      fetchImpl: sequentialJson([{ body: eventSuccess(request) }, { body: agentSuccess(true) }]),
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.agent_status).toMatchObject({ state: "fallback", actual_provider: "mock", fallback_used: true });
    }
  });

  it("keeps the Agent request alive past 6 seconds and aborts only at its 70-second limit", async () => {
    vi.useFakeTimers();
    const request = buildSimulatorRequest("sos", "E001", "2026-08-02T01:02:03Z");
    let calls = 0;
    let agentSignal: AbortSignal | undefined;
    let markAgentStarted: (() => void) | undefined;
    const agentStarted = new Promise<void>((resolve) => { markAgentStarted = resolve; });
    try {
      const pending = submitSimulatorEvent(request, {
        baseUrl: "",
        fetchImpl: (_input, init) => {
          calls += 1;
          if (calls === 1) {
            return Promise.resolve(new Response(JSON.stringify(eventSuccess(request)), {
              status: 201,
              headers: { "content-type": "application/json" },
            }));
          }
          agentSignal = init?.signal ?? undefined;
          markAgentStarted?.();
          return new Promise((_resolve, reject) => agentSignal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          }));
        },
      });
      await agentStarted;
      await vi.advanceTimersByTimeAsync(6_000);
      expect(agentSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(64_000);
      expect(agentSignal?.aborted).toBe(true);
      const result = await pending;
      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.data.agent_status).toEqual(expect.objectContaining({ state: "error", error_code: "timeout" }));
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects non-local backends and unsafe runtime requests before fetch", async () => {
    let called = false;
    const safe = buildSimulatorRequest("sos", "E001", "2026-08-02T01:02:03Z");
    const fetchImpl: typeof fetch = () => {
      called = true;
      return Promise.resolve(new Response(""));
    };
    expect((await submitSimulatorEvent(safe, { baseUrl: "https://example.com", fetchImpl })).status).toBe("error");
    expect((await submitSimulatorEvent(safe, { baseUrl: "http://0.0.0.0:3001", fetchImpl })).status).toBe("error");
    const unsafe = { ...safe, payload: { raw_text: "secret" } };
    const result = await submitSimulatorEvent(unsafe, { baseUrl: "", fetchImpl });
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.error.code).toBe("invalid_request");
    expect(called).toBe(false);
  });

  it("rejects cross-elder, sensitive, or out-of-range response traces", async () => {
    const request = buildSimulatorRequest("sos", "E001", "2026-08-02T01:02:03Z");
    const response = (eventPatch: Record<string, unknown>, riskPatch: Record<string, unknown>) => ({
      ok: true,
      event: { event_id: 1, ...request, status: "active", ...eventPatch },
      risk_result: {
        elder_id: "E001", status_level: "urgent", risk_score: 100,
        key_reasons: ["SOS"], recommended_action: "立即核实",
        safety_disclaimer: "本结果仅为照护风险提示，不构成医疗诊断。",
        ...riskPatch,
      },
      task: null,
    });
    for (const body of [
      response({ elder_id: "E002" }, {}),
      response({ payload: { coordinates: [1, 2] } }, {}),
      response({ occurred_at: "2026-08-02T01:02:04.000Z" }, {}),
      response({ payload: { simulation: "different" } }, {}),
      response({}, { risk_score: 101 }),
    ]) {
      const result = await submitSimulatorEvent(request, { baseUrl: "", fetchImpl: jsonResponse(body) });
      expect(result.status).toBe("error");
      if (result.status === "error") expect(result.error.code).toBe("invalid_payload");
    }
  });

  it("classifies HTTP, content-type, JSON and timeout failures without leaking bodies", async () => {
    const request = buildSimulatorRequest("sos", "E001", "2026-08-02T01:02:03Z");
    const cases: Array<[typeof fetch, string]> = [
      [() => Promise.resolve(new Response("SECRET", { status: 500 })), "http_error"],
      [() => Promise.resolve(new Response("SECRET", { status: 200, headers: { "content-type": "text/html" } })), "bad_content_type"],
      [() => Promise.resolve(new Response("{SECRET", { status: 200, headers: { "content-type": "application/json" } })), "bad_json"],
      [(_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => {
        const error = new Error("SECRET");
        error.name = "AbortError";
        reject(error);
      })), "timeout"],
    ];
    for (const [fetchImpl, code] of cases) {
      const result = await submitSimulatorEvent(request, { baseUrl: "", fetchImpl, timeoutMs: 10 });
      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.error.code).toBe(code);
        expect(JSON.stringify(result.error)).not.toContain("SECRET");
      }
    }
  });

  it("runs the Agent failure exercise deterministically without calling the real Agent", async () => {
    const status = agentExerciseStatus("agent_failure");
    expect(status.state).toBe("failure_exercise");
    expect(status.real_agent_called).toBe(false);
    expect(status.fallback_used).toBe(false);
    expect(status.expected_on_real_failure).toBe("显式 Mock fallback");

    const request = buildSimulatorRequest("agent_failure", "E001", "2026-08-02T01:02:03Z");
    let calls = 0;
    const result = await submitSimulatorEvent(request, {
      baseUrl: "",
      fetchImpl: (input, init) => {
        calls += 1;
        return jsonResponse(eventSuccess(request))(input, init);
      },
    });
    expect(calls).toBe(1);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.agent_status).toEqual(expect.objectContaining({
        state: "error",
        error_code: "failure_exercise",
      }));
    }
  });
});
