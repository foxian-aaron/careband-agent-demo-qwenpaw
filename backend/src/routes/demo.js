import { Router } from "express";
import { resetDemoData } from "../db.js";

const isLocalRequest = (req) => {
  const address = req.socket.remoteAddress ?? req.ip ?? "";
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
};

export function createDemoRouter(options = {}) {
  const router = Router();
  const requestIsLoopback = options.isLoopbackRequest ?? isLocalRequest;

  router.post("/reset", (req, res, next) => {
    try {
      const explicitlyAllowed = process.env.ALLOW_DEMO_RESET === "true";
      if (!explicitlyAllowed || !requestIsLoopback(req)) {
        res.status(403).json({
          ok: false,
          error:
            "Demo reset requires ALLOW_DEMO_RESET=true and a request from the local machine.",
        });
        return;
      }

      res.json({
        ok: true,
        reset: resetDemoData(),
        preserved_elder_ids: ["TEST001"],
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
