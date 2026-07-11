import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { getDb } from "./db.js";
import { agentRouter } from "./routes/agent.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { createDemoRouter } from "./routes/demo.js";
import { eldersRouter } from "./routes/elders.js";
import { eventsRouter } from "./routes/events.js";
import { importRouter } from "./routes/import.js";
import { snapshotsRouter } from "./routes/snapshots.js";
import { tasksRouter } from "./routes/tasks.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");
const distPath = path.join(projectRoot, "dist");
const port = Number(process.env.PORT ?? 3001);
const host = process.env.BACKEND_HOST ?? "127.0.0.1";
const corsOrigin = process.env.CORS_ORIGIN ?? "http://127.0.0.1:5173";

const isLoopbackRequest = (req) => {
  const address = req.socket.remoteAddress ?? req.ip ?? "";
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
};

export function createApp(options = {}) {
  const app = express();
  const serveStaticFrontend = process.env.SERVE_STATIC_FRONTEND !== "false";
  const hardwareMode = process.env.HARDWARE_MODE === "true";
  const requestIsLoopback = options.isLoopbackRequest ?? isLoopbackRequest;
  app.use(cors({ origin: corsOrigin === "*" ? true : corsOrigin }));
  app.use(express.json({ limit: "2mb" }));

  app.use("/api", (req, res, next) => {
    if (!hardwareMode || requestIsLoopback(req)) {
      next();
      return;
    }

    const lanHardwareRoute =
      (req.method === "GET" && req.path === "/health") ||
      (req.method === "POST" && req.path === "/events");
    if (lanHardwareRoute) {
      req.carebandLanHardwareRequest = true;
      next();
      return;
    }

    res.status(403).json({
      ok: false,
      error: "Hardware LAN mode exposes only GET /api/health and POST /api/events.",
    });
  });

  app.get("/api/health", (req, res) => {
    if (req.carebandLanHardwareRequest) {
      res.json({
        ok: true,
        service: "careband-agent-backend",
        version: "0.2.0",
        timestamp: new Date().toISOString(),
      });
      return;
    }
    const db = getDb();
    const elderCount = db.prepare("SELECT COUNT(*) AS count FROM elders").get().count;
    res.json({
      ok: true,
      service: "careband-agent-backend",
      version: "0.2.0",
      elders: elderCount,
      agent_mode:
        process.env.USE_MOCK_AGENT === "true"
          ? "mock"
          : process.env.AGENT_PROVIDER ?? "qwenpaw",
      timestamp: new Date().toISOString(),
    });
  });

  app.use("/api/elders", eldersRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/snapshots", snapshotsRouter);
  app.use("/api/events", eventsRouter);
  app.use("/api/import", importRouter);
  app.use("/api/agent", agentRouter);
  app.use("/api/tasks", tasksRouter);
  app.use("/api/demo", createDemoRouter({ isLoopbackRequest: requestIsLoopback }));

  app.use("/api", (_req, res) => {
    res.status(404).json({ ok: false, error: "API route not found." });
  });

  if (serveStaticFrontend && fs.existsSync(path.join(distPath, "index.html"))) {
    app.use(express.static(distPath));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) {
        next();
        return;
      }
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.use((error, _req, res, _next) => {
    if (error instanceof ZodError) {
      res.status(400).json({
        ok: false,
        error: "Request format is invalid.",
        details: error.flatten(),
      });
      return;
    }

    const statusCode = Number(error.statusCode);
    res.status(Number.isInteger(statusCode) && statusCode >= 400 ? statusCode : 500).json({
      ok: false,
      error: error.message ?? "Unknown server error.",
    });
  });

  return app;
}

export const app = createApp();

const directRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (directRun) {
  getDb();
  app.listen(port, host, () => {
    console.log(`CareBand Agent backend listening on http://${host}:${port}`);
  });
}
