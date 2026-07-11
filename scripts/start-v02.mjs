import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "..");
const node = process.execPath;

const env = {
  ...process.env,
  PORT: process.env.PORT ?? "3001",
  FRONTEND_PORT: process.env.FRONTEND_PORT ?? "5173",
  BACKEND_HOST: process.env.BACKEND_HOST ?? "127.0.0.1",
  SERVE_STATIC_FRONTEND: process.env.SERVE_STATIC_FRONTEND ?? "true",
  HARDWARE_MODE: process.env.HARDWARE_MODE ?? "false",
  ALLOW_DEMO_RESET: process.env.ALLOW_DEMO_RESET ?? "true",
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? "http://127.0.0.1:5173",
  VITE_API_BASE_URL: process.env.VITE_API_BASE_URL ?? "http://127.0.0.1:3001",
};

const children = [
  spawn(node, ["backend/src/server.js"], {
    cwd: projectRoot,
    env,
    stdio: "inherit",
  }),
  spawn(node, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", env.FRONTEND_PORT], {
    cwd: projectRoot,
    env,
    stdio: "inherit",
  }),
];

const stopAll = () => {
  for (const child of children) child.kill();
};

process.on("SIGINT", () => {
  stopAll();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopAll();
  process.exit(0);
});

for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      stopAll();
      process.exit(code);
    }
  });
}
