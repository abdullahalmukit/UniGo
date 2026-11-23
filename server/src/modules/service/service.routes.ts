import { Router } from "express";
import { authenticate, authUser } from "../../middleware/authenticate.js";
import { requireCanAct, requireVerifiedStudent } from "../../middleware/authorize.js";
import { parseInput, validateBody } from "../../middleware/validate.js";
import { fillPersonStats } from "../users/stats.service.js";
import {
  acceptServiceRequest,
  cancelServiceRequest,
  confirmPaymentMode,
  confirmPaymentReceived,
  createServiceRequest,
  deliverService,
  getServiceRequest,
  listServiceCategories,
  listServiceRequests,
  markPaymentSent,
  proposePaymentMode,
  startService,
  updateServiceRequest,
} from "./service.service.js";
import {
  createServiceSchema,
  editServiceSchema,
  listServicesQuery,
  type CreateServiceInput,
  type EditServiceInput,
} from "./service.validation.js";
import { markSuggestionTaken } from "../matching/matching.service.js";

export const serviceRouter = Router();

// Public: categories list
serviceRouter.get("/categories", async (_req, res) => {
  res.json({ categories: await listServiceCategories() });
});

// Authenticated: verified students only
serviceRouter.use(authenticate, requireVerifiedStudent);

const id = (value: unknown) => String(value);
const me = (req: Parameters<typeof authUser>[0]) => authUser(req).id;

// Browse & Search service requests
serviceRouter.get("/", async (req, res) => {
  const query = parseInput(listServicesQuery, req.query);
  res.json(await listServiceRequests(me(req), query));
});

// Create a new service request
serviceRouter.post("/requests", requireCanAct, validateBody(createServiceSchema), async (req, res) => {
  const request = await createServiceRequest(me(req), req.body as CreateServiceInput);
  res.status(201).json(await fillPersonStats({ request }));
});

// Get request details
serviceRouter.get("/requests/:id", async (req, res) => {
  const request = await getServiceRequest(me(req), id(req.params.id));
  res.json(await fillPersonStats({ request }));
});

// Edit open request
serviceRouter.patch("/requests/:id", requireCanAct, validateBody(editServiceSchema), async (req, res) => {
  const request = await updateServiceRequest(me(req), id(req.params.id), req.body as EditServiceInput);
  res.json(await fillPersonStats({ request }));
});

// Accept request
serviceRouter.post("/requests/:id/accept", requireCanAct, async (req, res) => {
  const request = await acceptServiceRequest(me(req), id(req.params.id));
  markSuggestionTaken(me(req), id(req.params.id));
  res.json(await fillPersonStats({ request }));
});

// Start service (transitions to IN_PROGRESS)
serviceRouter.post("/requests/:id/start", requireCanAct, async (req, res) => {
  const request = await startService(me(req), id(req.params.id));
  res.json(await fillPersonStats({ request }));
});

// Deliver service (transitions to SERVICE_DELIVERED, requests completion)
serviceRouter.post("/requests/:id/deliver", requireCanAct, async (req, res) => {
  const request = await deliverService(me(req), id(req.params.id));
  res.json(await fillPersonStats({ request }));
});

// Cancel service (payment-aware: requester blocked from cancelling if payment is PAID)
serviceRouter.post("/requests/:id/cancel", requireCanAct, async (req, res) => {
  const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
  const request = await cancelServiceRequest(me(req), id(req.params.id), reason);
  res.json(await fillPersonStats({ request }));
});

// Payment mode negotiation
serviceRouter.post("/requests/:id/propose-payment-mode", requireCanAct, async (req, res) => {
  const mode = req.body?.mode;
  if (mode !== "PRE_PAY" && mode !== "POST_PAY") {
    res.status(400).json({ code: "INVALID_MODE", message: "mode must be PRE_PAY or POST_PAY" });
    return;
  }
  const request = await proposePaymentMode(me(req), id(req.params.id), mode as "PRE_PAY" | "POST_PAY");
  res.json(await fillPersonStats({ request }));
});

serviceRouter.post("/requests/:id/confirm-payment-mode", requireCanAct, async (req, res) => {
  const request = await confirmPaymentMode(me(req), id(req.params.id));
  res.json(await fillPersonStats({ request }));
});

serviceRouter.post("/requests/:id/mark-payment-sent", requireCanAct, async (req, res) => {
  const request = await markPaymentSent(me(req), id(req.params.id));
  res.json(await fillPersonStats({ request }));
});

serviceRouter.post("/requests/:id/confirm-payment-received", requireCanAct, async (req, res) => {
  const request = await confirmPaymentReceived(me(req), id(req.params.id));
  res.json(await fillPersonStats({ request }));
});

