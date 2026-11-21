import { Router } from "express";
import { authenticate, authUser } from "../../middleware/authenticate.js";
import { parseInput, validateBody } from "../../middleware/validate.js";
import { rateUsRateLimit } from "../../middleware/rate-limit.js";
import { createSupportRequest, getUserSupportRequest, listUserSupportRequests, rateApp } from "./support.service.js";
import { createSupportSchema, rateUsSchema, type CreateSupportInput, type RateUsInput } from "./support.validation.js";

export const supportRouter = Router();
supportRouter.use(authenticate);

const me = (req: Parameters<typeof authUser>[0]) => authUser(req).id;
const id = (value: unknown) => String(value);

// Create a support request or submit app rating
supportRouter.post("/", validateBody(createSupportSchema), async (req, res) => {
  const request = await createSupportRequest(me(req), req.body as CreateSupportInput);
  res.status(201).json({ request });
});

// Rate Us (proposal 5): 1-5 stars and an optional comment
supportRouter.post("/rate", validateBody(rateUsSchema), rateUsRateLimit, async (req, res) => {
  res.status(201).json({ rating: await rateApp(me(req), req.body as RateUsInput) });
});

// List my support requests
supportRouter.get("/my", async (req, res) => {
  res.json({ requests: await listUserSupportRequests(me(req)) });
});

// Get a support request
supportRouter.get("/:id", async (req, res) => {
  res.json({ request: await getUserSupportRequest(me(req), id(req.params.id)) });
});

