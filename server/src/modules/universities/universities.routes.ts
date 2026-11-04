import { Router } from "express";
import { listOpenUniversities } from "./universities.service.js";

export const universitiesRouter = Router();

// Public: the register page needs the list before anyone is logged in.
universitiesRouter.get("/", async (_req, res) => {
  res.json({ universities: await listOpenUniversities() });
});
