import { adminCancelFood, getAdminFood, listAdminFood } from "../food/food.admin.service.js";
import { adminCancelService, getAdminService, listAdminServices } from "../service/service.admin.service.js";
import { listServiceCategories } from "../service/service.service.js";
import { addCustomCategory, deleteCustomCategory } from "../service/custom-categories.js";
import { adminResolveDispute, getDispute, listAdminDisputes } from "../disputes/disputes.service.js";
import { listDisputesQuery, resolveDisputeSchema, type ResolveDisputeInput } from "../disputes/disputes.validation.js";
import { adminResolveNoShow, getAdminNoShow, listAdminNoShows } from "../food/food.noshow.service.js";
import { adminReplySupport, getAdminSupportRequest, listAdminSupportRequests } from "../support/support.service.js";
import { adminReplySupportSchema, listSupportQuery, type AdminReplySupportInput } from "../support/support.validation.js";
import { prisma } from "../../lib/prisma.js";
import { recordAudit } from "./audit-log.js";
import { AppError } from "../../utils/app-error.js";
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
import { adminCancelActivity, adminCancelOffer, getAdminRideActivity, getAdminRideOffer, listAdminRides } from "../ride/ride.admin.service.js";
import { hideReview } from "../reviews/reviews.service.js";
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

// ---- Ride Sharing (B3b-2): Moderators and Super Admins (Q3) ------------------

const ridesQuery = z.object({
  kind: z.enum(["requests", "offers", "bookings"]).default("requests"),
  status: z.enum(["OPEN", "ACCEPTED", "IN_PROGRESS", "DISPUTED", "COMPLETED", "CANCELLED", "EXPIRED", "NOT_MARKED", "FULL", "CLOSED"]).optional(),
  q: optionalText,
  date: z.iso.date().optional(),
  subAreaId: z.uuid().optional(),
  page,
});
const adminReason = z.object({ reason: z.string().trim().min(rules.admin.reason.minLength).max(rules.admin.reason.maxLength) });
const hideReason = z.object({ reason: z.string().trim().min(rules.reviews.hideReason.minLength).max(rules.reviews.hideReason.maxLength) });

adminRouter.get("/rides", async (req, res) => {
  res.json(await listAdminRides(parseInput(ridesQuery, req.query)));
});

adminRouter.get("/rides/offers/:id", async (req, res) => {
  res.json({ offer: await getAdminRideOffer(id(req.params.id)) });
});

adminRouter.get("/rides/activities/:id", async (req, res) => {
  res.json({ ride: await getAdminRideActivity(id(req.params.id)) });
});

adminRouter.post("/rides/activities/:id/cancel", validateBody(adminReason), async (req, res) => {
  res.json({ ride: await adminCancelActivity(authUser(req).id, id(req.params.id), (req.body as z.infer<typeof adminReason>).reason, req.ip) });
});

adminRouter.post("/rides/offers/:id/cancel", validateBody(adminReason), async (req, res) => {
  res.json({ offer: await adminCancelOffer(authUser(req).id, id(req.params.id), (req.body as z.infer<typeof adminReason>).reason, req.ip) });
});

// ---- Food (B4): Moderators and Super Admins, as Ride Sharing --------------------

const foodQuery = z.object({
  status: z.enum(["OPEN", "ACCEPTED", "IN_PROGRESS", "DISPUTED", "COMPLETED", "CANCELLED", "EXPIRED", "NOT_MARKED"]).optional(),
  q: optionalText,
  date: z.iso.date().optional(),
  subAreaId: z.uuid().optional(),
  page,
});

adminRouter.get("/food", async (req, res) => {
  res.json(await listAdminFood(parseInput(foodQuery, req.query)));
});

adminRouter.get("/food/:id", async (req, res) => {
  res.json({ food: await getAdminFood(id(req.params.id)) });
});

adminRouter.post("/food/:id/cancel", validateBody(adminReason), async (req, res) => {
  res.json({ food: await adminCancelFood(authUser(req).id, id(req.params.id), (req.body as z.infer<typeof adminReason>).reason, req.ip) });
});

// ---- Uni Service (B5): View requests and remove policy-breaking requests ----------

const serviceAdminQuery = z.object({
  status: z.enum(["OPEN", "ACCEPTED", "IN_PROGRESS", "DISPUTED", "COMPLETED", "CANCELLED", "EXPIRED", "NOT_MARKED"]).optional(),
  q: optionalText,
  date: z.iso.date().optional(),
  subAreaId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  page,
});

adminRouter.get("/services", async (req, res) => {
  res.json(await listAdminServices(parseInput(serviceAdminQuery, req.query)));
});

adminRouter.get("/services/:id", async (req, res) => {
  res.json({ service: await getAdminService(id(req.params.id)) });
});

adminRouter.post("/services/:id/cancel", validateBody(adminReason), async (req, res) => {
  res.json({ service: await adminCancelService(authUser(req).id, id(req.params.id), (req.body as z.infer<typeof adminReason>).reason, req.ip) });
});

// Categories (Uni Service): list, add custom category, delete custom category
adminRouter.get("/services/categories/all", async (_req, res) => {
  res.json({ categories: await listServiceCategories() });
});

adminRouter.post("/services/categories", async (req, res) => {
  const name = String(req.body.name ?? "").trim();
  if (!name || name.length < 2 || name.length > 80) {
    throw new AppError(400, "INVALID_NAME", "Category name must be between 2 and 80 characters");
  }
  const sortOrder = typeof req.body.sortOrder === "number" ? req.body.sortOrder : 10;
  const created = addCustomCategory(name, sortOrder);
  await recordAudit(prisma, {
    adminId: authUser(req).id,
    action: "CONTENT_UPDATE",
    targetType: "service_category",
    targetId: created.id,
    newValue: { name: created.name },
  });
  res.status(201).json({ category: created });
});

adminRouter.delete("/services/categories/:id", async (req, res) => {
  const success = deleteCustomCategory(id(req.params.id));
  if (!success) throw new AppError(404, "CATEGORY_NOT_FOUND", "Custom category not found");
  await recordAudit(prisma, {
    adminId: authUser(req).id,
    action: "CONTENT_UPDATE",
    targetType: "service_category",
    targetId: id(req.params.id),
    newValue: { deleted: true },
  });
  res.status(204).end();
});

// ---- Reviews (B3b-2): hide with a reason, audited -------------------------------

adminRouter.post("/reviews/:id/hide", validateBody(hideReason), async (req, res) => {
  await hideReview(authUser(req).id, id(req.params.id), (req.body as z.infer<typeof hideReason>).reason, req.ip);
  res.status(204).end();
});

// ---- Disputes & Complaints (B7) ------------------------------------------------

adminRouter.get("/disputes", async (req, res) => {
  res.json(await listAdminDisputes(parseInput(listDisputesQuery, req.query)));
});

adminRouter.get("/disputes/:id", async (req, res) => {
  res.json({ dispute: await getDispute(authUser(req).id, id(req.params.id)) });
});

adminRouter.post("/disputes/:id/resolve", validateBody(resolveDisputeSchema), async (req, res) => {
  res.json({ dispute: await adminResolveDispute(authUser(req).id, id(req.params.id), req.body as ResolveDisputeInput, req.ip) });
});

// ---- Food No-Show Reports (B7) --------------------------------------------------

const noShowQuery = z.object({
  status: z.enum(["OPEN", "UNDER_REVIEW", "RESOLVED", "DISMISSED"]).optional(),
  page,
});

adminRouter.get("/no-shows", async (req, res) => {
  const { page: p, status: s } = parseInput(noShowQuery, req.query);
  res.json(await listAdminNoShows(p, s));
});

adminRouter.get("/no-shows/:id", async (req, res) => {
  res.json({ report: await getAdminNoShow(id(req.params.id)) });
});

const resolveNoShowSchema = z.object({
  status: z.enum(["RESOLVED", "DISMISSED"]),
  resolutionNote: z.string().trim().min(3).max(2000),
  action: z.enum(["warn", "restrict", "suspend", "ban"]).optional(),
  actionReason: z.string().trim().min(3).max(500).optional(),
  suspensionDays: z.coerce.number().int().min(1).max(365).optional(),
});

adminRouter.post("/no-shows/:id/resolve", validateBody(resolveNoShowSchema), async (req, res) => {
  res.json({ report: await adminResolveNoShow(authUser(req).id, id(req.params.id), req.body as z.infer<typeof resolveNoShowSchema>, req.ip) });
});

// ---- Support Requests & App Feedback (B7) ----------------------------------------

adminRouter.get("/support", async (req, res) => {
  res.json(await listAdminSupportRequests(parseInput(listSupportQuery, req.query)));
});

adminRouter.get("/support/:id", async (req, res) => {
  res.json({ request: await getAdminSupportRequest(id(req.params.id)) });
});

adminRouter.post("/support/:id/reply", validateBody(adminReplySupportSchema), async (req, res) => {
  res.json({ request: await adminReplySupport(authUser(req).id, id(req.params.id), req.body as AdminReplySupportInput, req.ip) });
});

// ---- Disputed Chat Access (Privacy Rule, Proposal 13, B7) -----------------------
// Normally chats are private; admins can only read chats if the activity is DISPUTED
// or has an open dispute or report. Access is recorded in Audit Log.

adminRouter.get("/chats/:id/messages", async (req, res) => {
  const chatId = id(req.params.id);
  const adminId = authUser(req).id;
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: {
      activity: {
        select: {
          id: true,
          status: true,
          creatorId: true,
          accepterId: true,
        },
      },
    },
  });
  if (!chat) throw new AppError(404, "CHAT_NOT_FOUND", "Chat not found");

  const hasOpenDispute = await prisma.dispute.findFirst({
    where: { activityId: chat.activityId, status: { in: ["OPEN", "UNDER_REVIEW"] } },
  });
  const hasOpenReport = await prisma.report.findFirst({
    where: { activityId: chat.activityId, status: { in: ["OPEN", "UNDER_REVIEW"] } },
  });

  const isDisputed = chat.activity.status === "DISPUTED" || Boolean(hasOpenDispute) || Boolean(hasOpenReport);
  if (!isDisputed) {
    throw new AppError(403, "CHAT_IS_PRIVATE", "Admins may only read chats for disputed activities or open reports");
  }

  await recordAudit(prisma, {
    adminId,
    action: "DISPUTED_CHAT_READ",
    targetType: "chat",
    targetId: chatId,
    targetUserId: chat.activity.creatorId,
    newValue: { activityId: chat.activityId },
    ipAddress: req.ip,
  });

  const messages = await prisma.message.findMany({
    where: { chatId },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  res.json({ messages });
});

// ---- Fix Mistaken PAID Status (ভুল PAID ঠিক করা, B7) ----------------------------

adminRouter.post("/payments/:id/correct-unpaid", validateBody(adminReason), async (req, res) => {
  const paymentId = id(req.params.id);
  const adminId = authUser(req).id;
  const { reason } = req.body as z.infer<typeof adminReason>;

  const payment = await prisma.paymentRecord.findUnique({ where: { id: paymentId } });
  if (!payment) throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment record not found");
  if (payment.status !== "PAID") {
    throw new AppError(400, "NOT_PAID", "This payment is not marked as PAID");
  }

  await prisma.paymentRecord.update({
    where: { id: paymentId },
    data: { status: "UNPAID", paidAt: null },
  });

  await recordAudit(prisma, {
    adminId,
    action: "PAYMENT_STATUS_CORRECTED",
    targetType: "payment_record",
    targetId: paymentId,
    targetUserId: payment.payeeId,
    oldValue: { status: "PAID" },
    newValue: { status: "UNPAID", reason },
    ipAddress: req.ip,
  });

  res.json({ success: true, message: "Payment status corrected to UNPAID" });
});

// ---- Clear Late Cancellation Flag (late flag মোছা, B7) ---------------------------

adminRouter.post("/activities/:id/clear-late-flag", validateBody(adminReason), async (req, res) => {
  const activityId = id(req.params.id);
  const adminId = authUser(req).id;
  const { reason } = req.body as z.infer<typeof adminReason>;

  const activity = await prisma.activity.findUnique({ where: { id: activityId } });
  if (!activity) throw new AppError(404, "ACTIVITY_NOT_FOUND", "Activity not found");

  await prisma.activity.update({
    where: { id: activityId },
    data: { isLateCancellation: false },
  });

  await recordAudit(prisma, {
    adminId,
    action: "LATE_CANCELLATION_CLEARED",
    targetType: "activity",
    targetId: activityId,
    targetUserId: activity.creatorId,
    oldValue: { isLateCancellation: activity.isLateCancellation },
    newValue: { isLateCancellation: false, reason },
    ipAddress: req.ip,
  });

  res.json({ success: true, message: "Late cancellation flag cleared" });
});
