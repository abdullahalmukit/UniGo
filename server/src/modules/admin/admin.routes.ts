import { Router } from "express";
import { z } from "zod";
import { authenticate, authUser } from "../../middleware/authenticate.js";
import { requireRole } from "../../middleware/authorize.js";
import { parseInput, validateBody } from "../../middleware/validate.js";
import {
  createSubArea,
  createSubAreaSchema,
  listSubAreasForAdmin,
  removeSubArea,
  updateSubArea,
  updateSubAreaSchema,
  type CreateSubAreaInput,
  type UpdateSubAreaInput,
} from "../subareas/subareas.admin.service.js";
import { rules } from "../../config/rules.js";
import { listFareSettings, setRatePerKm } from "../ride/fare.service.js";
import { listAuditLogs } from "./audit-log.service.js";
import { getDashboard } from "./dashboard.service.js";
import { actionSchemas, applyAccountAction, type AccountAction, type ActionInput } from "./moderation.service.js";
import { getUserForAdmin, listUsers } from "./users.service.js";

// The admin panel API (proposal section 17). Moderators and Super Admins get
// in; Super-Admin-only parts say so (A8 decisions 3 and 4). Student
// verifications and universities have their own routers (A6).
export const adminRouter = Router();
adminRouter.use(authenticate, requireRole("MODERATOR", "SUPER_ADMIN"));
const superAdminOnly = requireRole("SUPER_ADMIN");

const page = z.coerce.number().int().min(1).default(1);
const optionalText = z.string().trim().min(1).max(200).optional();
const id = (value: unknown) => String(value);

adminRouter.get("/dashboard", async (_req, res) => {
  res.json(await getDashboard());
});

// ---- Users --------------------------------------------------------------------

const usersQuery = z.object({
  q: optionalText,
  accountStatus: z.enum(["ACTIVE", "RESTRICTED", "SUSPENDED", "BANNED"]).optional(),
  verification: z.enum(["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"]).optional(),
  role: z.enum(["USER", "MODERATOR", "SUPER_ADMIN"]).optional(),
  universityId: optionalText,
  page,
});

adminRouter.get("/users", async (req, res) => {
  res.json(await listUsers(parseInput(usersQuery, req.query)));
});

adminRouter.get("/users/:id", async (req, res) => {
  res.json({ user: await getUserForAdmin(id(req.params.id)) });
});

for (const action of Object.keys(actionSchemas) as AccountAction[]) {
  adminRouter.post(`/users/:id/${action}`, superAdminOnly, validateBody(actionSchemas[action]), async (req, res) => {
    const result = await applyAccountAction(authUser(req).id, id(req.params.id), action, req.body as ActionInput, req.ip);
    res.json(result);
  });
}

// ---- Sub-Areas (Super Admin) --------------------------------------------------

adminRouter.get("/sub-areas", superAdminOnly, async (_req, res) => {
  res.json({ subAreas: await listSubAreasForAdmin() });
});

adminRouter.post("/sub-areas", superAdminOnly, validateBody(createSubAreaSchema), async (req, res) => {
  res.status(201).json({ subArea: await createSubArea(authUser(req).id, req.body as CreateSubAreaInput, req.ip) });
});

adminRouter.patch("/sub-areas/:id", superAdminOnly, validateBody(updateSubAreaSchema), async (req, res) => {
  res.json({ subArea: await updateSubArea(authUser(req).id, id(req.params.id), req.body as UpdateSubAreaInput, req.ip) });
});

adminRouter.delete("/sub-areas/:id", superAdminOnly, async (req, res) => {
  res.json(await removeSubArea(authUser(req).id, id(req.params.id), req.ip));
});

// ---- Fare Settings (Super Admin, B3a) -----------------------------------------

const fareSchema = z.object({
  ratePerKm: z.coerce.number().min(rules.ride.ratePerKm.min).max(rules.ride.ratePerKm.max).transform((v) => Math.round(v * 100) / 100),
});

adminRouter.get("/fare-settings", superAdminOnly, async (_req, res) => {
  res.json(await listFareSettings());
});

adminRouter.post("/fare-settings", superAdminOnly, validateBody(fareSchema), async (req, res) => {
  res.status(201).json(await setRatePerKm(authUser(req).id, (req.body as z.infer<typeof fareSchema>).ratePerKm, req.ip));
});

// ---- Audit Log (Super Admin) --------------------------------------------------

const auditQuery = z.object({
  adminId: optionalText,
  action: optionalText,
  targetType: optionalText,
  targetUserId: optionalText,
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page,
});

adminRouter.get("/audit-logs", superAdminOnly, async (req, res) => {
  res.json(await listAuditLogs(parseInput(auditQuery, req.query)));
});
