import { Router } from "express";
import { resetDemoData } from "../db.js";

export const demoRouter = Router();

const isLocalRequest = (req) => {
  const address = req.socket.remoteAddress ?? req.ip ?? "";
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
};

demoRouter.post("/reset", (req, res, next) => {
  try {
    const explicitlyAllowed = process.env.ALLOW_DEMO_RESET === "true";
    if (
      (!isLocalRequest(req) && !explicitlyAllowed) ||
      (process.env.NODE_ENV === "production" && !explicitlyAllowed)
    ) {
      res.status(403).json({
        ok: false,
        error: "Demo reset is only available from the local machine.",
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
