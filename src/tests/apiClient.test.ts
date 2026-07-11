import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiAnalyzeAgent,
  apiGetDailySnapshotsCsvHistory,
  apiImportDailySnapshotsCsv,
  apiPreviewDailySnapshotsCsv,
  apiResetDemo,
  ApiRequestError,
  requestJson,
  submitNormalizedEvent,
} from "../lib/apiClient";

describe("apiClient requestJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns parsed JSON for successful API responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, value: 42 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(requestJson<{ value: number }>("/api/test")).resolves.toMatchObject({ value: 42 });
  });

  it("throws a useful short error for non-JSON responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("<html><body>temporary tunnel warning page</body></html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      ),
    );

    await expect(requestJson("/api/health")).rejects.toThrow(
      /API did not return JSON\. status=200, content-type=text\/html; charset=utf-8, preview=<html>/,
    );
  });

  it("preserves the HTTP status for a rejected task transition", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: false, error: "urgent task cannot be cancelled" }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const request = requestJson("/api/tasks/TASK-1", { method: "PATCH" });

    await expect(request).rejects.toMatchObject({
      name: "ApiRequestError",
      status: 409,
      message: "urgent task cannot be cancelled",
    } satisfies Partial<ApiRequestError>);
  });

  it("aborts requests after the configured timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
      ),
    );

    const request = requestJson("/api/slow", {}, 25);
    const expectation = expect(request).rejects.toThrow("API request timed out after 25ms");
    await vi.advanceTimersByTimeAsync(25);

    await expectation;
  });

  it("previews a CSV file with elder and source metadata as multipart form data", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const form = init?.body as FormData;
      expect(init?.method).toBe("POST");
      expect(form).toBeInstanceOf(FormData);
      expect(form.get("elder_id")).toBe("E001");
      expect(form.get("source")).toBe("CSV");
      expect(form.get("file")).toBeInstanceOf(Blob);
      expect(init?.headers).toBeUndefined();
      return new Response(
        JSON.stringify({ ok: true, count: 1, snapshots: [], preview: { warnings: [] } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await apiPreviewDailySnapshotsCsv({
      elderId: "E001",
      source: "CSV",
      file: new Blob(["date,steps\n2026-07-01,1000"], { type: "text/csv" }),
      filename: "daily.csv",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/import/daily-snapshots-csv/preview");
  });

  it("confirms an already-previewed CSV through the import endpoint", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const form = init?.body as FormData;
      expect(form.get("elder_id")).toBe("TEST001");
      expect(form.get("source")).toBe("Apple Health Export");
      return new Response(
        JSON.stringify({ ok: true, import_id: "IMP-1", count: 1, snapshots: [] }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await apiImportDailySnapshotsCsv({
      elderId: "TEST001",
      source: "Apple Health Export",
      file: new Blob(["elder_id,date\nTEST001,2026-07-01"], { type: "text/csv" }),
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/import/daily-snapshots-csv");
    expect(response.import_id).toBe("IMP-1");
  });

  it("loads persistent CSV import history for the selected elder", async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      new Response(
        JSON.stringify({ ok: true, imports: [{ import_id: "IMP-1", elder_id: "E001" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await apiGetDailySnapshotsCsvHistory("E001");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/import/daily-snapshots-csv/history?elder_id=E001",
    );
    expect(response.imports[0]?.import_id).toBe("IMP-1");
  });

  it("sends only the elder and source event references for Agent analysis", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        elder_id: "E001",
        source_event_id: "EVT-1",
      });
      return new Response(
        JSON.stringify({
          ok: true,
          output_id: "OUT-1",
          run_id: "RUN-1",
          elder_id: "E001",
          source_event_id: "EVT-1",
          agent_result: {},
          meta: {},
          created_at: "2026-07-11T00:00:00.000Z",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await apiAnalyzeAgent({ elder_id: "E001", source_event_id: "EVT-1" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/agent/analyze");
  });

  it("uses the local demo reset endpoint", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      return new Response(
        JSON.stringify({ ok: true, reset: {}, preserved_elder_ids: ["TEST001"] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await apiResetDemo();

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/demo/reset");
  });

  it("submits a normalized hardware event then asks the server Agent to analyze it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            event: { event_id: "EVT-SOS", elder_id: "E001" },
            risk_result: { status_level: "urgent" },
            task: { task_id: "TASK-SOS" },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, output_id: "OUT-1", agent_result: {}, meta: {} }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitNormalizedEvent({
      elder_id: "E001",
      event_type: "sos",
      source: "esp32",
      payload: { action: "long_press" },
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/events",
      "/api/agent/analyze",
    ]);
    expect(result.agentError).toBeNull();
  });

  it("keeps the accepted event result visible when Agent analysis fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            event: { event_id: "EVT-1", elder_id: "E001" },
            risk_result: { status_level: "attention" },
            task: null,
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      )
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitNormalizedEvent({
      elder_id: "E001",
      event_type: "voice",
      source: "mobile_app",
      payload: { action: "symptom_report" },
    });

    expect(result.eventResponse.event.event_id).toBe("EVT-1");
    expect(result.agentResponse).toBeNull();
    expect(result.agentError).toBe("offline");
  });
});
