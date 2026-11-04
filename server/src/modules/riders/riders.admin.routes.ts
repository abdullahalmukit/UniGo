import { Router } from "express";
import { z } from "zod";
import { authenticate, authUser } from "../../middleware/authenticate.js";
import { requireRole } from "../../middleware/authorize.js";
import { parseInput, validateBody } from "../../middleware/validate.js";
import {
  approveApplication,
  documentFileUrl,
  getApplication,
  listApplications,
  listRiders,
  reinstateRider,
  rejectApplication,
  suspendRider,
} from "./riders.admin.service.js";
import { reinstateRiderSchema, rejectApplicationSchema, suspendRiderSchema } from "./riders.validation.js";

// Rider Requests (proposal section 17). Reviewing is Moderator and Super Admin
// work; suspending and reinstating riders is Super Admin only (B1 decision 8).
const page = z.coerce.number().int().min(1).default(1);
const id = (value: unknown) => String(value);

export const adminRiderApplicationsRouter = Router();
adminRiderApplicationsRouter.use(authenticate, requireRole("MODERATOR", "SUPER_ADMIN"));

const applicationsQuery = z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED"]).default("PENDING"), page });

adminRiderApplicationsRouter.get("/", async (req, res) => {
  const { status, page: p } = parseInput(applicationsQuery, req.query);
  res.json(await listApplications(status, p));
});

adminRiderApplicationsRouter.get("/:id", async (req, res) => {
  res.json({ application: await getApplication(id(req.params.id)) });
});

adminRiderApplicationsRouter.get("/:id/documents/:documentId/file-url", async (req, res) => {
  res.json(await documentFileUrl(id(req.params.id), id(req.params.documentId)));
});

adminRiderApplicationsRouter.post("/:id/approve", async (req, res) => {
  await approveApplication(authUser(req).id, id(req.params.id), req.ip);
  res.status(204).end();
});

adminRiderApplicationsRouter.post("/:id/reject", validateBody(rejectApplicationSchema), async (req, res) => {
  await rejectApplication(authUser(req).id, id(req.params.id), req.body.reason, req.ip);
  res.status(204).end();
});

export const adminRidersRouter = Router();
adminRidersRouter.use(authenticate, requireRole("MODERATOR", "SUPER_ADMIN"));
const superAdminOnly = requireRole("SUPER_ADMIN");

const ridersQuery = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).optional(),
  page,
});

adminRidersRouter.get("/", async (req, res) => {
  res.json(await listRiders(parseInput(ridersQuery, req.query)));
});

adminRidersRouter.post("/:id/suspend", superAdminOnly, validateBody(suspendRiderSchema), async (req, res) => {
  res.json(await suspendRider(authUser(req).id, id(req.params.id), req.body, req.ip));
});

adminRidersRouter.post("/:id/reinstate", superAdminOnly, validateBody(reinstateRiderSchema), async (req, res) => {
  res.json(await reinstateRider(authUser(req).id, id(req.params.id), req.body.reason, req.ip));
});
