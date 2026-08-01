// backend/src/app.js
//
// Express application factory + shared handlers.
//
// Stage 2 contract:
//   * GET /api/health -> 200 JSON { ok, service, mode, timestamp }
//   * Unknown /api/*  -> JSON 404 (no HTML, no stack, no path)
//   * Any thrown error -> safe JSON 500 (no stack, no path)
//
// `createApp` builds the pipeline; `server.js` is the only module that listens.

import express from "express";

import eventsRouter from "./routes/events.js";
import tasksRouter from "./routes/tasks.js";

function healthHandler(_req, res) {
  res.status(200).json({
    ok: true,
    service: "careband-agent-backend",
    // The backend only exists in "local complete mode" (see docs/rebuild
    // 00_SCOPE §2); the static-pages mode has no backend. mode is therefore a
    // fixed, safe descriptor.
    mode: "local",
    timestamp: new Date().toISOString(),
  });
}

// Unknown /api/* -> fixed JSON 404. Never reflects the request path or any
// internal detail.
export function notFoundHandler(_req, res) {
  res.status(404).json({ ok: false, error: "not_found" });
}

// Terminal error handler. Maps body-parser JSON failures (malformed JSON and an
// oversized body) to a fixed safe 400 validation_error; every other unexpected
// error still falls through to the safe 500. The error itself is never echoed,
// so no message, stack, or local path can reach the client. (The four-arg
// signature is required by Express to identify an error handler.)
export function errorHandler(err, _req, res, _next) {
  const errType = err && typeof err.type === "string" ? err.type : "";
  if (errType === "entity.parse.failed" || errType === "entity.too.large") {
    return res.status(400).json({ ok: false, error: "validation_error" });
  }
  res.status(500).json({ ok: false, error: "internal_error" });
}

export function createApp() {
  const application = express();
  application.disable("x-powered-by");

  // 64kb body limit: canonical events are small and structured; raw voice /
  // audio / large blobs are permanently out of scope (see AGENTS.md §6).
  application.use(express.json({ limit: "64kb" }));

  application.get("/api/health", healthHandler);
  // Canonical event + caregiver task routes (Stage 5). Mounted before the
  // /api 404 fallthrough so their paths are matched first.
  application.use("/api/events", eventsRouter);
  application.use("/api/tasks", tasksRouter);
  // Fallthrough for any other /api/* method/path -> JSON 404.
  application.use("/api", notFoundHandler);
  // Last resort for unexpected errors -> safe JSON 500.
  application.use(errorHandler);

  return application;
}

export const app = createApp();
