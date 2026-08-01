import { describe, expect, it } from "vitest";
import { fetchDashboard, resolveBaseUrl } from "../lib/apiClient";
import { InvalidBackendPayloadError, mapDashboard } from "../lib/backendMapping";
import { mockProfiles } from "../data/mockProfiles";
import { createInitialDemoState, demoReducer, getRiskForElder, serializeForStorage } from "../store/demoStore";
import type { BackendSyncPayload, CareEvent, CareTask, DailySnapshot, ElderProfile, RiskResult } from "../types";

// --- fixtures ---------------------------------------------------------------
type FetchImpl = typeof fetch;
const json = (body: unknown, status = 200, type = "application/json"): FetchImpl => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": type } }));
const hanging = (): FetchImpl => (_i, init) =>
  new Promise((_r, rej) => init?.signal?.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); }));
const mockProfilesRecord = mockProfiles.reduce<Record<string, ElderProfile>>((r, p) => { r[p.elderId] = p; return r; }, {});
const elder = (id: string, o: Record<string, unknown> = {}): Record<string, unknown> => ({
  elder_id: id, name: id, age: 78, room: "203", risk_tags: [], subject_kind: "elder", created_at: "2026-08-01T12:00:00.000Z", ...o });
const risk = (id: string, o: Record<string, unknown> = {}): Record<string, unknown> => ({
  elder_id: id, status_level: "data_insufficient", risk_score: 0, key_reasons: ["佩戴或数据质量不足"],
  triggered_rules: ["data_insufficient"], recommended_action: "请确认设备佩戴与数据上传情况",
  data_quality: 0, safety_disclaimer: "本结果仅为照护风险提示，不构成医疗诊断。", ...o });
const row = (id: string, elderO: Record<string, unknown> = {}, riskO: Record<string, unknown> = {}): Record<string, unknown> => ({
  elder: elder(id, elderO), latest_snapshot: null, events: [], active_events: [], risk_result: risk(id, riskO), tasks: [], latest_agent_output: null, latest_agent_run: null });
/** Complete dashboard with a patched E001 risk; null omits E001 risk_result. */
const singleRowDashboard = (riskPatch: Record<string, unknown> | null): unknown => ({
  ok: true, generated_at: "2026-08-01T12:00:00.000Z", operational_summary: {},
  rows: [{ elder: elder("E001"), latest_snapshot: null, events: [], active_events: [], risk_result: riskPatch === null ? null : { ...risk("E001"), ...riskPatch }, tasks: [], latest_agent_output: null, latest_agent_run: null }, row("E002"), row("E003"), row("E004")] });
const validDashboard = (): unknown => ({
  ok: true, generated_at: "2026-08-01T12:00:00.000Z",
  rows: [
    {
      elder: elder("E001", { name: "陈伯", room: "203", risk_tags: ["轻度跌倒风险"] }),
      latest_snapshot: { data_quality: 90, wear_time_hours: 12, steps: 5000, sleep_duration: 7 },
      events: [
        { event_id: 1, elder_id: "FORGED-EID", event_type: "sos", source: "software_simulator", occurred_at: "2026-08-01T11:00:00.000Z", status: "active", payload: { note: "should-not-leak-raw-text" } },
        { event_id: 3, event_type: "medication", payload: { action: "missed" } },
        { event_id: 4, event_type: "location" }, { event_id: 5, event_type: "device_status" }, { event_id: 6, event_type: "manual_note" },
        { event_id: 2, event_type: "totally_unknown_type", source: "system" }, // dropped
      ],
      active_events: [],
      risk_result: risk("E001", { status_level: "urgent", risk_score: 100, key_reasons: ["检测到活跃 SOS 求救信号"], triggered_rules: ["sos_active"], recommended_action: "立即联系老人核实情况", data_quality: 90 }),
      tasks: [{ task_id: 1, elder_id: "FORGED-EID", status: "open", risk_level: "urgent", key_reasons: ["SOS 求助"], recommended_action: "立即处理", created_at: "2026-08-01T11:00:00.000Z", updated_at: "2026-08-01T11:00:00.000Z" }],
      latest_agent_output: null, latest_agent_run: null,
    },
    row("E002", { name: "李婆婆", room: "205" }),
    row("E003", { name: "黄叔", room: "201" }, { status_level: "stable", risk_score: 12 }),
    row("E004", { name: "梁婆婆", room: "206" }, { status_level: "stable", risk_score: 12 }),
    row("E999", { name: "测试长者", room: "T99" }, { status_level: "stable", risk_score: 5 }),
    row("TEST001", { name: "测试账号", room: "T01", subject_kind: "team_test" }, { status_level: "stable", risk_score: 12 }),
  ],
  operational_summary: { elder_count: 4, urgent_count: 1, high_risk_count: 0, active_task_count: 1, status_distribution: { urgent: 1, data_insufficient: 2, stable: 2 } },
});
const DIM_INSUFFICIENT = { vitals: "data_insufficient", activity: "data_insufficient", sleep: "data_insufficient", medication: "data_insufficient", safety: "data_insufficient" } as const;
const samplePayload = (o: Partial<BackendSyncPayload> = {}): BackendSyncPayload => ({
  generatedAt: "2026-08-01T12:00:00.000Z",
  profiles: { E001: { elderId: "E001", name: "陈伯", age: 78, room: "203", floor: "二楼", chronicConditions: ["高血压"], riskTags: ["server-tag"], caregiverId: "CG-A", familyContactId: "FAM-E001" } },
  snapshots: { E001: { elderId: "E001", date: "2026-08-01", heartRate: 80, stepsToday: 3000, activeMinutes: 20, sleepDuration: 6, medicationMorning: "confirmed", medicationEvening: "not_confirmed", wearTimeHours: 12, locationZone: "长者中心二楼", safeZoneStatus: "inside", fallDetected: false, dataCompleteness: 0.9, lastSyncedAt: "2026-08-01T12:00:00.000Z" } },
  events: [], tasks: [], operationalStates: { E001: "normal" },
  riskMap: { E001: { elderId: "E001", riskLevel: "attention", riskScore: 55, dimensions: { ...DIM_INSUFFICIENT }, keyReasons: ["server-reason"], triggeredRules: ["server-rule"], recommendedAction: "server-action", dataCompleteness: 0.9, confidence: 0.9, medicalDisclaimer: "server-disclaimer" } },
  operationalSummary: { elderCount: 1, urgentCount: 0, highRiskCount: 0, activeTaskCount: 0, statusDistribution: { attention: 1 } },
  ...o,
});
const netErr = { code: "network", message: "网络错误，使用本地 Mock 数据" } as const;
const base = createInitialDemoState;
const connected = (payload: BackendSyncPayload = samplePayload()) => demoReducer(base(), { type: "BACKEND_CONNECTED", payload });

// --- A. apiClient: base URL, fetch safety -----------------------------------
describe("apiClient", () => {
  it("resolveBaseUrl: explicit wins (trailing slash stripped), local dev same-origin, else null", () => {
    expect(resolveBaseUrl({ env: { VITE_API_BASE_URL: "http://example.com:8080/api/" }, hostname: "x" })).toBe("http://example.com:8080/api");
    expect(resolveBaseUrl({ env: {}, hostname: "localhost" })).toBe("");
    expect(resolveBaseUrl({ env: {}, hostname: "127.0.0.1" })).toBe("");
    expect(resolveBaseUrl({ env: {}, hostname: "0.0.0.0" })).toBe("");
    expect(resolveBaseUrl({ env: {}, hostname: "careband.example.com" })).toBeNull();
    expect(resolveBaseUrl({ env: { VITE_API_BASE_URL: "https://api.example" }, hostname: "foxian-aaron.github.io" })).toBeNull();
  });
  it("local default requests exactly /api/dashboard (Vite proxy); static preview never fetches", async () => {
    let url = "";
    const capture: FetchImpl = (input) => { url = String(input); return json({ ok: true, generated_at: "x", rows: [] })(input); };
    const r = await fetchDashboard({ baseUrl: resolveBaseUrl({ env: {}, hostname: "localhost" }), fetchImpl: capture });
    expect(url).toBe("/api/dashboard");
    expect(r.status).toBe("connected");
    let called = false;
    await fetchDashboard({ baseUrl: null, fetchImpl: () => { called = true; return Promise.resolve(new Response("")); } });
    expect(called).toBe(false);
  });
  it("classifies content-type / http / invalid_payload errors and never leaks secrets", async () => {
    const r1 = await fetchDashboard({ baseUrl: "http://x", fetchImpl: () => Promise.resolve(new Response("<html>SECRET-HTML</html>", { status: 200, headers: { "content-type": "text/html" } })) });
    if (r1.status === "mock") { expect(r1.error.code).toBe("bad_content_type"); expect(JSON.stringify(r1.error)).not.toContain("SECRET-HTML"); }
    const r2 = await fetchDashboard({ baseUrl: "http://x", fetchImpl: json({ leak: "SECRET-BODY" }, 500) });
    if (r2.status === "mock") { expect(r2.error.code).toBe("http_error"); expect(r2.error.status).toBe(500); expect(JSON.stringify(r2.error)).not.toContain("SECRET-BODY"); }
    const r3 = await fetchDashboard({ baseUrl: "http://x", fetchImpl: json({ ok: false }) });
    if (r3.status === "mock") expect(r3.error.code).toBe("invalid_payload");
  });
  it("classifies timeout/network safely without leaking host, path or stack", async () => {
    const r1 = await fetchDashboard({ baseUrl: "http://127.0.0.1:3001", fetchImpl: hanging(), timeoutMs: 40 });
    if (r1.status === "mock") { expect(r1.error.code).toBe("timeout"); expect(JSON.stringify(r1.error)).not.toContain("127.0.0.1"); expect(JSON.stringify(r1.error)).not.toContain("aborted"); }
    const r2 = await fetchDashboard({ baseUrl: "http://127.0.0.1:3001", fetchImpl: () => Promise.reject(new Error("ECONNREFUSED 127.0.0.1:3001")) });
    if (r2.status === "mock") { expect(r2.error.code).toBe("network"); expect(JSON.stringify(r2.error)).not.toContain("ECONNREFUSED"); expect(JSON.stringify(r2.error)).not.toContain("127.0.0.1"); }
  });
});

// --- B. backendMapping: untrusted payload -> product state ------------------
describe("mapDashboard valid payload", () => {
  const payload = mapDashboard(validDashboard(), mockProfilesRecord);
  it("maps only E001-E004 (subject_kind=elder), excluding TEST001/E005/E999", () => {
    expect(Object.keys(payload.profiles).sort()).toEqual(["E001", "E002", "E003", "E004"]);
    for (const id of ["TEST001", "E005", "E999"]) {
      expect(payload.profiles).not.toHaveProperty(id);
      expect(payload.riskMap).not.toHaveProperty(id);
      expect(payload.snapshots).not.toHaveProperty(id);
    }
    expect(payload.events.find((e) => e.elderId === "E999")).toBeUndefined();
    expect(payload.tasks.find((t) => t.elderId === "E999")).toBeUndefined();
    const p = payload.profiles.E001;
    expect(p.name).toBe("陈伯"); expect(p.room).toBe("203");
    expect(p.riskTags).toEqual(["轻度跌倒风险"]); expect(p.floor).toBe("二楼");
  });
  it("maps server risk verbatim with all five dimensions data_insufficient", () => {
    const r = payload.riskMap.E001 as RiskResult;
    expect(r.riskLevel).toBe("urgent"); expect(r.riskScore).toBe(100);
    expect(r.keyReasons).toEqual(["检测到活跃 SOS 求救信号"]);
    expect(r.triggeredRules).toEqual(["sos_active"]);
    expect(r.recommendedAction).toBe("立即联系老人核实情况");
    expect(r.medicalDisclaimer).toBe("本结果仅为照护风险提示，不构成医疗诊断。");
    expect(r.dimensions).toEqual(DIM_INSUFFICIENT);
  });
  it("maps null snapshot to an honest placeholder and non-null snapshot to server fields", () => {
    const e2 = payload.snapshots.E002 as DailySnapshot;
    expect(e2.heartRate).toBeNull(); expect(e2.dataCompleteness).toBe(0);
    expect(e2.wearTimeHours).toBe(0); expect(e2.safeZoneStatus).toBe("unknown");
    expect(e2.locationZone).toBe("数据不足"); expect(e2.medicationMorning).toBe("not_required");
    const e1 = payload.snapshots.E001 as DailySnapshot;
    expect(e1.stepsToday).toBe(5000); expect(e1.sleepDuration).toBe(7);
    expect(e1.dataCompleteness).toBeCloseTo(0.9, 5);
  });
  it("events: safe title, no raw text, software_simulator source, row elderId; unknown type dropped", () => {
    const ev = payload.events.find((e) => e.elderId === "E001") as CareEvent;
    expect(ev.eventType).toBe("sos"); expect(ev.title).toBe("SOS 求助事件");
    expect(ev.source).toBe("software_simulator"); expect(ev.rawText).toBeUndefined();
    expect(JSON.stringify(ev)).not.toContain("should-not-leak-raw-text");
    expect(payload.events).toHaveLength(5); // known canonical events kept; unknown dropped
    expect(payload.events.find((e) => e.eventId === "EVT-SRV-3")?.title).toBe("用药未确认");
    expect(payload.events.map((e) => e.eventType)).toEqual(expect.arrayContaining(["location_alert", "device_status", "manual_note"]));
  });
  it("tasks: server risk fields only, and use the row elderId (forged nested id ignored)", () => {
    const task = payload.tasks[0] as CareTask;
    expect(task.elderId).toBe("E001"); expect(task.status).toBe("pending");
    expect(task.priority).toBe("urgent"); expect(task.reason).toContain("SOS 求助");
    expect(task.recommendedAction).toBe("立即处理");
  });
});

describe("mapDashboard rejects invalid payloads", () => {
  it.each([
    ["non-object", "nope"],
    ["ok not true", { ok: false, generated_at: "x", rows: [] }],
    ["missing generated_at", { ok: true, rows: [] }],
    ["unparseable generated_at", { ok: true, generated_at: "x", operational_summary: {}, rows: [] }],
    ["rows not array", { ok: true, generated_at: "2026-08-01T12:00:00.000Z", rows: "nope" }],
  ])("rejects %s", (_label, data) => {
    expect(() => mapDashboard(data, mockProfilesRecord)).toThrow(InvalidBackendPayloadError);
  });
  it("rejects a mapped elder lacking an authoritative risk_result", () => {
    expect(() => mapDashboard(singleRowDashboard(null), mockProfilesRecord)).toThrow(InvalidBackendPayloadError);
  });
  it("rejects missing or duplicate formal elder rows", () => {
    const missing = singleRowDashboard({}) as { rows: unknown[] };
    missing.rows.pop();
    expect(() => mapDashboard(missing, mockProfilesRecord)).toThrow(InvalidBackendPayloadError);
    const duplicate = validDashboard() as { rows: unknown[] }; duplicate.rows.push(row("E001"));
    expect(() => mapDashboard(duplicate, mockProfilesRecord)).toThrow(InvalidBackendPayloadError);
  });
  // data_quality: only null or a finite number; undefined/missing/string/bool/NaN reject.
  it.each([
    ["status_level undefined", { status_level: undefined }],
    ["status_level bogus", { status_level: "bogus" }],
    ["risk_score string", { risk_score: "high" }],
    ["risk_score NaN", { risk_score: NaN }],
    ["key_reasons non-array", { key_reasons: "reason" }],
    ["triggered_rules non-string", { triggered_rules: [1, 2] }],
    ["recommended_action empty", { recommended_action: "" }],
    ["recommended_action blank", { recommended_action: "   " }],
    ["safety_disclaimer empty", { safety_disclaimer: "" }],
    ["data_quality undefined", { data_quality: undefined }],
    ["data_quality string", { data_quality: "90" }],
    ["data_quality boolean", { data_quality: true }],
  ])("rejects risk_result with %s", (_label, patch) => {
    expect(() => mapDashboard(singleRowDashboard(patch), mockProfilesRecord)).toThrow(InvalidBackendPayloadError);
  });
  it("accepts risk_result with data_quality null or a finite number", () => {
    expect(() => mapDashboard(singleRowDashboard({ data_quality: null }), mockProfilesRecord)).not.toThrow();
    const mapped = mapDashboard(singleRowDashboard({ data_quality: 42 }), mockProfilesRecord);
    expect(mapped.riskMap.E001.dataCompleteness).toBeCloseTo(0.42, 5);
  });
  it("does not mutate the input", () => {
    const data = validDashboard();
    const snap = JSON.parse(JSON.stringify(data));
    mapDashboard(data, mockProfilesRecord);
    expect(data).toEqual(snap);
  });
});

// --- C. demoStore: backend state, write gating, persistence helper ----------
describe("demoStore", () => {
  it("connecting -> connected hydrates server data; failure -> mock restores mock data", () => {
    let s = demoReducer(base(), { type: "BACKEND_CONNECTING" });
    expect(s.backend.status).toBe("connecting");
    s = demoReducer(s, { type: "BACKEND_CONNECTED", payload: samplePayload() });
    expect(s.backend.status).toBe("connected"); expect(s.backend.mode).toBe("backend");
    expect(s.backend.lastSyncedAt).toBe("2026-08-01T12:00:00.000Z");
    expect(s.profiles.E001.riskTags).toEqual(["server-tag"]);
    expect(s.snapshots.E001.dataCompleteness).toBeCloseTo(0.9, 5);
    s = demoReducer(s, { type: "BACKEND_FAILED", error: netErr });
    expect(s.backend.status).toBe("mock"); expect(s.backend.mode).toBe("mock"); expect(s.backend.error?.code).toBe("network");
    expect(Object.keys(s.profiles)).toContain("E005"); expect(s.serverData).toBeNull();
  });
  it("connected returns server risk (not frontend stable); mock uses frontend rules", () => {
    const r = getRiskForElder(connected(), "E001");
    expect(r.riskLevel).toBe("attention"); expect(r.riskScore).toBe(55);
    expect(r.recommendedAction).toBe("server-action");
    expect(getRiskForElder(base(), "E001").recommendedAction).not.toBe("server-action");
  });
  it("connected never falls back to frontend risk when server risk is missing", () => {
    expect(() => getRiskForElder(connected(samplePayload({ riskMap: {} })), "E001"))
      .toThrow("authoritative server risk unavailable");
  });
  it("connected blocks local writes (readOnlyNotice); mock still applies", () => {
    const before = JSON.parse(JSON.stringify(connected().tasks));
    const next = demoReducer(connected(), { type: "TRIGGER_SOS" });
    expect(next.tasks).toEqual(before);
    expect(next.backend.readOnlyNotice).toContain("连接写操作将在下一切片实现");
    expect(demoReducer(base(), { type: "TRIGGER_SOS" }).events.some((e) => e.eventType === "sos")).toBe(true);
  });
  it("mock custom data survives CONNECTING -> FAILED without reset", () => {
    let s = demoReducer(base(), { type: "TRIGGER_SOS" });
    const eBefore = s.events.length; const tBefore = s.tasks.length;
    s = demoReducer(s, { type: "BACKEND_CONNECTING" });
    s = demoReducer(s, { type: "BACKEND_FAILED", error: netErr });
    expect(s.backend.status).toBe("mock");
    expect(s.events.length).toBe(eBefore); expect(s.tasks.length).toBe(tBefore);
    expect(s.events.some((e) => e.eventType === "sos")).toBe(true);
    expect(s.serverData).toBeNull();
  });
  it("serializeForStorage omits server data and serverData in connected and mock modes", () => {
    const c = serializeForStorage(connected());
    const cs = JSON.stringify(c);
    expect(cs).not.toContain("server-tag"); expect(cs).not.toContain("server-action"); expect(cs).not.toContain("server-reason");
    expect("serverData" in c).toBe(false);
    const m = serializeForStorage(base());
    expect("serverData" in m).toBe(false);
    expect(JSON.stringify(m)).not.toContain("serverData");
    const voice = serializeForStorage(demoReducer(base(), { type: "TRIGGER_CHEN_DIZZINESS" }));
    expect(voice.events.every((event) => event.rawText === undefined)).toBe(true);
    expect(JSON.stringify(voice)).not.toContain("rawText");
  });
});
