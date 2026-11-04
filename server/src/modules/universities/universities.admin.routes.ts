import { Router } from "express";
import type { z } from "zod";
import { authenticate, authUser } from "../../middleware/authenticate.js";
import { requireRole } from "../../middleware/authorize.js";
import { validateBody } from "../../middleware/validate.js";
import {
  addDomainSchema,
  addUniversityDomain,
  createUniversity,
  createUniversitySchema,
  deleteUniversity,
  listAllUniversities,
  removeUniversityDomain,
  updateUniversity,
  updateUniversitySchema,
  type CreateInput,
  type UpdateInput,
} from "./universities.admin.service.js";

// Super Admin only (A6 decision 4).

export const adminUniversitiesRouter = Router();
adminUniversitiesRouter.use(authenticate, requireRole("SUPER_ADMIN"));

adminUniversitiesRouter.get("/", async (_req, res) => {
  res.json({ universities: await listAllUniversities() });
});

adminUniversitiesRouter.post("/", validateBody(createUniversitySchema), async (req, res) => {
  res.status(201).json({ university: await createUniversity(authUser(req).id, req.body as CreateInput, req.ip) });
});

adminUniversitiesRouter.patch("/:id", validateBody(updateUniversitySchema), async (req, res) => {
  res.json({ university: await updateUniversity(authUser(req).id, String(req.params.id), req.body as UpdateInput, req.ip) });
});

adminUniversitiesRouter.delete("/:id", async (req, res) => {
  await deleteUniversity(authUser(req).id, String(req.params.id), req.ip);
  res.status(204).end();
});

adminUniversitiesRouter.post("/:id/domains", validateBody(addDomainSchema), async (req, res) => {
  const { domain } = req.body as z.infer<typeof addDomainSchema>;
  res.status(201).json({ domain: await addUniversityDomain(authUser(req).id, String(req.params.id), domain, req.ip) });
});

adminUniversitiesRouter.delete("/:id/domains/:domainId", async (req, res) => {
  await removeUniversityDomain(authUser(req).id, String(req.params.id), String(req.params.domainId), req.ip);
  res.status(204).end();
});
