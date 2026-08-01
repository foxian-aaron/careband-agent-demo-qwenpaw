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

// Terminal error handler. Ignores the error entirely so no message, stack, or
// local path can ever reach the client. (The four-arg signature is required by
// Express to identify an error handler.)
export function errorHandler(_err, _req, res, _next) {
  res.status(500).json({ ok: false, error: "internal_error" });
}

export function createApp() {
  const application = express();
  application.disable("x-powered-by");

  application.get("/api/health", healthHandler);
  // Fallthrough for any other /api/* method/path -> JSON 404.
  application.use("/api", notFoundHandler);
  // Last resort for unexpected errors -> safe JSON 500.
  application.use(errorHandler);

  return application;
}

export const app = createApp();
