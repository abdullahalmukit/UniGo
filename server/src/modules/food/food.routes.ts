import { Router } from "express";
import { z } from "zod";
import { authenticate, authUser } from "../../middleware/authenticate.js";
import { requireCanAct, requireVerifiedStudent } from "../../middleware/authorize.js";
import { singleImageUpload } from "../../middleware/upload.js";
import { parseInput, validateBody } from "../../middleware/validate.js";
import { AppError } from "../../utils/app-error.js";
import { fillPersonStats } from "../users/stats.service.js";
import { confirmOrderDetails, decideBudgetApproval, requestBudgetApproval, saveOrderDetails, uploadReceipt } from "./food.order.service.js";
import { acceptFoodRequest, createFoodRequest, foodConfig, getFoodRequest, listFood, loadFood, updateFoodRequest, upgradeFoodRequest } from "./food.service.js";
import {
  approvalSchema,
  confirmOrderSchema,
  createSchema,
  editSchema,
  listQuery,
  orderSchema,
  receiptSchema,
  upgradeSchema,
  type CreateInput,
  type EditInput,
  type OrderInput,
} from "./food.validation.js";

// Food Delivery (proposal section 10). Verified students only; RESTRICTED
// accounts cannot create or accept (requireCanAct) but can still see, cancel
// and finish what they have. Cancelling, completion and deleting an OPEN
// request use /api/activities (B2a); payment and reviews use the B3b-2
// activity endpoints. My Orders and Accepted Orders are the Activity feed
// with feature=food (B3b-1).
export const foodRouter = Router();
foodRouter.use(authenticate, requireVerifiedStudent);

const id = (value: unknown) => String(value);
const me = (req: Parameters<typeof authUser>[0]) => authUser(req).id;

foodRouter.get("/config", (_req, res) => {
  res.json(foodConfig());
});

// All Available and Search (10.1)
foodRouter.get("/", async (req, res) => {
  res.json(await fillPersonStats(await listFood(me(req), parseInput(listQuery, req.query))));
});

foodRouter.post("/requests", requireCanAct, validateBody(createSchema), async (req, res) => {
  res.status(201).json(await fillPersonStats({ request: await createFoodRequest(me(req), req.body as CreateInput) }));
});

foodRouter.get("/requests/:id", async (req, res) => {
  res.json(await fillPersonStats({ request: await getFoodRequest(me(req), id(req.params.id)) }));
});

foodRouter.patch("/requests/:id", requireCanAct, validateBody(editSchema), async (req, res) => {
  res.json(await fillPersonStats({ request: await updateFoodRequest(me(req), id(req.params.id), req.body as EditInput) }));
});

foodRouter.post("/requests/:id/upgrade", requireCanAct, validateBody(upgradeSchema), async (req, res) => {
  const { deliveryCharge } = req.body as z.infer<typeof upgradeSchema>;
  res.json(await fillPersonStats({ request: await upgradeFoodRequest(me(req), id(req.params.id), deliveryCharge) }));
});

foodRouter.post("/requests/:id/accept", requireCanAct, async (req, res) => {
  res.json(await fillPersonStats({ request: await acceptFoodRequest(me(req), id(req.params.id)) }));
});

// --- After acceptance: order details, over-budget approval, receipt (10.3, 10.4)

foodRouter.put("/requests/:id/order", validateBody(orderSchema), async (req, res) => {
  res.json(await fillPersonStats({ request: await saveOrderDetails({ id: me(req) }, id(req.params.id), req.body as OrderInput) }));
});

foodRouter.post("/requests/:id/order/confirm", validateBody(confirmOrderSchema), async (req, res) => {
  const { version } = req.body as z.infer<typeof confirmOrderSchema>;
  res.json(await fillPersonStats({ request: await confirmOrderDetails({ id: me(req) }, id(req.params.id), version) }));
});

foodRouter.post("/requests/:id/budget-approvals", validateBody(approvalSchema), async (req, res) => {
  const { amount } = req.body as z.infer<typeof approvalSchema>;
  res.status(201).json(await fillPersonStats({ request: await requestBudgetApproval({ id: me(req) }, id(req.params.id), amount) }));
});

foodRouter.post("/requests/:id/budget-approvals/:approvalId/approve", async (req, res) => {
  res.json(await fillPersonStats({ request: await decideBudgetApproval({ id: me(req) }, id(req.params.id), id(req.params.approvalId), true) }));
});

foodRouter.post("/requests/:id/budget-approvals/:approvalId/reject", async (req, res) => {
  res.json(await fillPersonStats({ request: await decideBudgetApproval({ id: me(req) }, id(req.params.id), id(req.params.approvalId), false) }));
});

// The receipt photo (JPG/PNG, 5 MB, first bytes checked) and the actual cost.
// The request is checked before the upload is read.
foodRouter.post(
  "/requests/:id/receipt",
  async (req, _res, next) => {
    const row = await loadFood(id(req.params.id));
    if (row.accepterId !== me(req) && row.creatorId !== me(req)) {
      next(new AppError(403, "NOT_PARTICIPANT", "You are not part of this activity"));
      return;
    }
    next();
  },
  singleImageUpload("receipt"),
  async (req, res) => {
    const { actualCost } = parseInput(receiptSchema, req.body);
    res.status(201).json(await fillPersonStats({ request: await uploadReceipt({ id: me(req) }, id(req.params.id), req.file!.buffer, actualCost) }));
  },
);
