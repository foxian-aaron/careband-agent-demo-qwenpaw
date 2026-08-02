import { describe, expect, it } from "vitest";
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
      fetchImpl: jsonResponse({
        ok: true,
        event: { event_id: 7, ...request, status: "active", ignored: "not copied" },
        risk_result: {
          elder_id: "E001",
          status_level: "urgent",
          risk_score: 100,
          key_reasons: ["检测到活跃 SOS 求救信号"],
          recommended_action: "立即联系老人核实情况",
          safety_disclaimer: "本结果仅为照护风险提示，不构成医疗诊断。",
          ignored: "not copied",
        },
        task: {
          task_id: 9,
          elder_id: "E001",
          status: "open",
          risk_level: "urgent",
          recommended_action: "立即联系老人核实情况",
          ignored: "not copied",
        },
      }),
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.http_status).toBe(201);
      expect(result.data.event.source).toBe("software_simulator");
      expect(result.data.risk_result.status_level).toBe("urgent");
      expect(result.data.task?.task_id).toBe(9);
      expect(JSON.stringify(result.data)).not.toContain("ignored");
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

  it("labels the Agent failure scenario as an exercise without claiming a real call", () => {
    const status = agentExerciseStatus("agent_failure");
    expect(status.state).toBe("failure_exercise");
    expect(status.real_agent_called).toBe(false);
    expect(status.fallback_used).toBe(false);
    expect(status.expected_on_real_failure).toBe("显式 Mock fallback");
  });
});
