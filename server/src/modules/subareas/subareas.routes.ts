import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { parseInput } from "../../middleware/validate.js";
import { subAreaSearchSchema } from "../users/users.validation.js";
import { searchSubAreas } from "./subareas.service.js";

// The active sub-areas from the admin master list, for logged-in users to pick from.
export const subAreasRouter = Router();
subAreasRouter.use(authenticate);

subAreasRouter.get("/", async (req, res) => {
  const { q } = parseInput(subAreaSearchSchema, req.query);
  res.json({ subAreas: await searchSubAreas(q) });
});
