import { Router } from "express";
import { authenticate, authUser } from "../../middleware/authenticate.js";
import { requireCanAct, requireVerifiedStudent } from "../../middleware/authorize.js";
import { parseInput, validateBody } from "../../middleware/validate.js";
import { fillPersonStats } from "../users/stats.service.js";
import {
  acceptServiceRequest,
  createServiceRequest,
  deliverService,
  getServiceRequest,
  listServiceCategories,
  listServiceRequests,
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

