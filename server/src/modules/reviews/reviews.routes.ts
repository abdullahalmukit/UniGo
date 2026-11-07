import { Router } from "express";
import { z } from "zod";
import { rules } from "../../config/rules.js";
import { authenticate, authUser } from "../../middleware/authenticate.js";
import { validateBody } from "../../middleware/validate.js";
import { getPayment, markPaymentPaid, setPaymentMethod } from "../payments/payments.service.js";
import { getActivityReviews, submitReview } from "./reviews.service.js";

// Per-activity reviews (15.1) and payment records (16), for the two
// participants. Mounted at /api/activities next to the lifecycle routes.
export const activityExtrasRouter = Router();
activityExtrasRouter.use(authenticate);

const id = (value: unknown) => String(value);

const reviewSchema = z.object({
  rating: z.coerce.number().int().min(rules.reviews.minStars).max(rules.reviews.maxStars),
  comment: z.string().trim().max(rules.reviews.commentMaxLength).nullish(),
});

activityExtrasRouter.get("/:id/reviews", async (req, res) => {
  res.json(await getActivityReviews(authUser(req).id, id(req.params.id)));
});

activityExtrasRouter.post("/:id/review", validateBody(reviewSchema), async (req, res) => {
  res.status(201).json(await submitReview(authUser(req).id, id(req.params.id), req.body as z.infer<typeof reviewSchema>));
});

const methodSchema = z.object({ method: z.enum(rules.payments.methods) });

activityExtrasRouter.get("/:id/payment", async (req, res) => {
  res.json({ payment: await getPayment(authUser(req).id, id(req.params.id)) });
});

activityExtrasRouter.patch("/:id/payment", validateBody(methodSchema), async (req, res) => {
  res.json({ payment: await setPaymentMethod(authUser(req).id, id(req.params.id), (req.body as z.infer<typeof methodSchema>).method) });
});

activityExtrasRouter.post("/:id/payment/paid", async (req, res) => {
  res.json({ payment: await markPaymentPaid(authUser(req).id, id(req.params.id)) });
});

