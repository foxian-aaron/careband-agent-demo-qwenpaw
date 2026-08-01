import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Same-origin /api proxy for dev + preview: the browser talks to its own origin
// (no CORS), and Vite forwards to the backend. Fixed target, no env wiring.
const apiProxy = { target: "http://127.0.0.1:3001", changeOrigin: true };

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { proxy: { "/api": apiProxy } },
  preview: { proxy: { "/api": apiProxy } },
});
