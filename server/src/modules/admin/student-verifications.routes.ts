import { Router } from "express";
import { z } from "zod";
import { authenticate, authUser } from "../../middleware/authenticate.js";
import { requireRole } from "../../middleware/authorize.js";
import { parseInput, validateBody } from "../../middleware/validate.js";
import { rejectSchema } from "../verification/verification.validation.js";
import { approveIdCard, idCardFileUrl, listIdCardVerifications, rejectIdCard } from "./student-verifications.service.js";

// Verifications are Moderator work as well as Super Admin work (proposal section 17).
export const adminStudentVerificationsRouter = Router();
adminStudentVerificationsRouter.use(authenticate, requireRole("MODERATOR", "SUPER_ADMIN"));

const listQuery = z.object({
  status: z.enum(["PENDING", "VERIFIED", "REJECTED"]).default("PENDING"),
  page: z.coerce.number().int().min(1).default(1),
});

adminStudentVerificationsRouter.get("/", async (req, res) => {
  const { status, page } = parseInput(listQuery, req.query);
  res.json(await listIdCardVerifications(status, page));
});

adminStudentVerificationsRouter.get("/:id/file-url", async (req, res) => {
  res.json(await idCardFileUrl(String(req.params.id)));
});

adminStudentVerificationsRouter.post("/:id/approve", async (req, res) => {
  await approveIdCard(authUser(req).id, String(req.params.id), req.ip);
  res.status(204).end();
});

adminStudentVerificationsRouter.post("/:id/reject", validateBody(rejectSchema), async (req, res) => {
  await rejectIdCard(authUser(req).id, String(req.params.id), (req.body as z.infer<typeof rejectSchema>).reason, req.ip);
  res.status(204).end();
});
