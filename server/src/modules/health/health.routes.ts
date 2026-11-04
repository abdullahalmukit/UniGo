import { Router } from "express";
import { isDatabaseUp } from "./health.service.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  const databaseUp = await isDatabaseUp();

  res.status(databaseUp ? 200 : 503).json({
    status: databaseUp ? "ok" : "degraded",
    database: databaseUp ? "up" : "down",
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});
