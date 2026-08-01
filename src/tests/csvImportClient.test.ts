import { describe, expect, it } from "vitest";
import {
  MAX_CSV_BYTES,
  confirmDailySnapshotsCsv,
  decodeUtf8Csv,
  fetchDailySnapshotsCsvHistory,
  formatCsvWarning,
  isLocalCsvBaseUrl,
  previewDailySnapshotsCsv,
  validateCsvText,
} from "../lib/apiClient";

type FetchImpl = typeof fetch;

const jsonResponse = (body: unknown, status = 200, contentType = "application/json"): FetchImpl =>
  () => Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": contentType },
  }));

const capture = (
  sink: { url: string; init?: RequestInit },
  next: FetchImpl,
): FetchImpl => (input, init) => {
  sink.url = String(input);
  sink.init = init;
  return next(input, init);
};

const previewBody = {
  ok: true,
  count: 1,
  snapshots: [{
    elder_id: "TEST001",
    date: "2026-08-01",
    data_source: "CSV Import",
    heart_rate_avg: 72,
    resting_heart_rate: 60,
    steps: 1200,
    active_minutes: 30,
    sleep_duration: 7.5,
    wear_time_hours: 20,
    data_quality: 90,
  }],
  date_range: { start: "2026-08-01", end: "2026-08-01" },
  quality_summary: {
    rows: 1,
    avg_data_quality: 90,
    min_data_quality: 90,
    max_data_quality: 90,
    low_quality_rows: 0,
  },
  warnings: [],
};

describe("Stage 9B CSV import API client", () => {
  it("previews with exact JSON contract and never sends file_name or risk fields", async () => {
    const sink = { url: "", init: undefined as RequestInit | undefined };
    const csvText = "elder_id,date,data_source\nignored,2026-08-01,ignored";
    const result = await previewDailySnapshotsCsv(csvText, {
      baseUrl: "",
      fetchImpl: capture(sink, jsonResponse(previewBody)),
    });
    expect(result).toEqual({ status: "ok", data: previewBody });
    expect(sink.url).toBe("/api/import/daily-snapshots-csv/preview");
    expect(sink.init?.method).toBe("POST");
    expect(JSON.parse(String(sink.init?.body))).toEqual({ elder_id: "TEST001", csv_text: csvText });
    expect(String(sink.init?.body)).not.toMatch(/file_name|risk_score|status_level/);
  });

  it("confirms the exact previewed text through the confirm endpoint", async () => {
    const sink = { url: "", init: undefined as RequestInit | undefined };
    const csvText = "header\nexact text";
    const body = { ok: true, import_run_id: 7, imported: 1, date_range: { start: "2026-08-01", end: "2026-08-01" } };
    const result = await confirmDailySnapshotsCsv(csvText, {
      baseUrl: "http://127.0.0.1:3001",
      fetchImpl: capture(sink, jsonResponse(body, 201)),
    });
    expect(result).toEqual({ status: "ok", data: body });
    expect(sink.url).toBe("http://127.0.0.1:3001/api/import/daily-snapshots-csv");
    expect(JSON.parse(String(sink.init?.body)).csv_text).toBe(csvText);
  });

  it("loads TEST001 history with the fixed limit", async () => {
    const sink = { url: "", init: undefined as RequestInit | undefined };
    const body = { ok: true, elder_id: "TEST001", limit: 20, runs: [] };
    const result = await fetchDailySnapshotsCsvHistory({
      baseUrl: "",
      fetchImpl: capture(sink, jsonResponse(body)),
    });
    expect(result).toEqual({ status: "ok", data: body });
    expect(sink.url).toBe("/api/import/daily-snapshots-csv/history?elder_id=TEST001&limit=20");
    expect(sink.init?.method).toBe("GET");
  });

  it("static preview returns a fixed error and performs zero fetches", async () => {
    let calls = 0;
    const fetchImpl: FetchImpl = () => {
      calls += 1;
      return Promise.resolve(new Response(""));
    };
    const results = await Promise.all([
      previewDailySnapshotsCsv("x", { baseUrl: null, fetchImpl }),
      confirmDailySnapshotsCsv("x", { baseUrl: null, fetchImpl }),
      fetchDailySnapshotsCsvHistory({ baseUrl: null, fetchImpl }),
    ]);
    expect(calls).toBe(0);
    for (const result of results) {
      expect(result.status).toBe("error");
      if (result.status === "error") expect(result.error.code).toBe("static_preview");
    }
  });

  it("refuses to send raw CSV to a non-loopback API base", async () => {
    expect(isLocalCsvBaseUrl("https://collector.example")).toBe(false);
    expect(isLocalCsvBaseUrl("http://127.0.0.1:3001")).toBe(true);
    expect(isLocalCsvBaseUrl("http://127.0.0.1:3001", "demo.example.com")).toBe(false);
    let calls = 0;
    const result = await previewDailySnapshotsCsv("header\nvalue", {
      baseUrl: "https://collector.example",
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(new Response(""));
      },
    });
    expect(calls).toBe(0);
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.error.code).toBe("local_only");
  });

  it("rejects empty and over-64-KiB text before any request", async () => {
    expect(validateCsvText("")?.code).toBe("invalid_csv");
    expect(validateCsvText("a".repeat(MAX_CSV_BYTES + 1))?.code).toBe("csv_too_large");
    expect(validateCsvText("a".repeat(MAX_CSV_BYTES))).toBeNull();
    let calls = 0;
    const result = await previewDailySnapshotsCsv("a".repeat(MAX_CSV_BYTES + 1), {
      baseUrl: "",
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(new Response(""));
      },
    });
    expect(calls).toBe(0);
    expect(result.status).toBe("error");
  });

  it("rejects malformed UTF-8 bytes instead of silently replacing them", () => {
    const invalid = decodeUtf8Csv(Uint8Array.of(0xff).buffer);
    expect(invalid.status).toBe("error");
    if (invalid.status === "error") expect(invalid.error.code).toBe("invalid_encoding");

    const valid = decodeUtf8Csv(new TextEncoder().encode("日期,步数\n2026-08-01,1200").buffer);
    expect(valid).toEqual({ status: "ok", text: "日期,步数\n2026-08-01,1200" });
  });

  it("classifies HTTP and invalid payload failures without leaking response content", async () => {
    const http = await previewDailySnapshotsCsv("x", {
      baseUrl: "",
      fetchImpl: jsonResponse({ error: "SECRET_BODY" }, 400),
    });
    expect(http.status).toBe("error");
    if (http.status === "error") {
      expect(http.error.code).toBe("http_error");
      expect(http.error.status).toBe(400);
      expect(JSON.stringify(http.error)).not.toContain("SECRET_BODY");
    }
    const invalid = await previewDailySnapshotsCsv("x", {
      baseUrl: "",
      fetchImpl: jsonResponse({ ok: true, snapshots: "SECRET_PAYLOAD" }),
    });
    expect(invalid.status).toBe("error");
    if (invalid.status === "error") {
      expect(invalid.error.code).toBe("invalid_payload");
      expect(JSON.stringify(invalid.error)).not.toContain("SECRET_PAYLOAD");
    }
  });

  it("rejects extra risk fields and malformed history metadata", async () => {
    const risky = await previewDailySnapshotsCsv("x", {
      baseUrl: "",
      fetchImpl: jsonResponse({ ...previewBody, status_level: "urgent" }),
    });
    expect(risky.status).toBe("error");
    if (risky.status === "error") expect(risky.error.code).toBe("invalid_payload");

    const malformedHistory = await fetchDailySnapshotsCsvHistory({
      baseUrl: "",
      fetchImpl: jsonResponse({
        ok: true,
        elder_id: "TEST001",
        limit: 20,
        runs: [{
          import_run_id: 1,
          elder_id: "TEST001",
          created_at: "2026-08-02T00:00:00Z",
          source: {},
          file_name: "daily_snapshots.csv",
          row_count: 1,
          date_range: { start: "2026-08-01", end: "2026-08-01" },
          quality_summary: previewBody.quality_summary,
        }],
      }),
    });
    expect(malformedHistory.status).toBe("error");
    if (malformedHistory.status === "error") {
      expect(malformedHistory.error.code).toBe("invalid_payload");
    }
  });

  it("only accepts documented warning shapes and renders local copy", async () => {
    expect(formatCsvWarning("2 row(s) contain one or more missing measurements"))
      .toBe("2 行包含缺失测量值");
    expect(formatCsvWarning("1 row(s) have data_quality below 50"))
      .toBe("1 行数据质量低于 50");
    expect(formatCsvWarning("RAW_CSV token path")) .toBeNull();

    const leaked = await previewDailySnapshotsCsv("x", {
      baseUrl: "",
      fetchImpl: jsonResponse({ ...previewBody, warnings: ["RAW_CSV token path"] }),
    });
    expect(leaked.status).toBe("error");
  });
});
