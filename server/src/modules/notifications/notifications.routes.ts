import { Router } from "express";
import { z } from "zod";
import { rules } from "../../config/rules.js";
import { authenticate, authUser } from "../../middleware/authenticate.js";
import { pushSubscribeRateLimit } from "../../middleware/rate-limit.js";
import { parseInput, validateBody } from "../../middleware/validate.js";
import {
  deletePushSubscription,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  savePushSubscription,
  unreadCount,
  type SubscriptionInput,
} from "./notifications.service.js";
import { pushAvailable, vapidPublicKey } from "./push.transport.js";

// In-app notifications (proposal section 14). Every logged-in user; SUSPENDED
// and BANNED accounts are refused by `authenticate`.
export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

const listQuery = z.object({ before: z.string().trim().min(1).max(64).optional() });

notificationsRouter.get("/", async (req, res) => {
  const { before } = parseInput(listQuery, req.query);
  res.json(await listNotifications(authUser(req).id, before));
});

notificationsRouter.get("/unread-count", async (req, res) => {
  res.json(await unreadCount(authUser(req).id));
});

notificationsRouter.post("/read-all", async (req, res) => {
  res.json(await markAllNotificationsRead(authUser(req).id));
});

notificationsRouter.post("/:id/read", async (req, res) => {
  res.json(await markNotificationRead(authUser(req).id, String(req.params.id)));
});

// Web Push: the public VAPID key, and this device's subscription.
export const pushRouter = Router();
pushRouter.use(authenticate);

pushRouter.get("/config", (_req, res) => {
  res.json({ available: pushAvailable(), publicKey: vapidPublicKey() });
});

const base64url = z
  .string()
  .trim()
  .min(1)
  .max(rules.notifications.keyMaxLength)
  .regex(/^[A-Za-z0-9_-]+=*$/, "Invalid key");
const endpoint = z.url({ protocol: /^https$/ }).max(rules.notifications.endpointMaxLength);
const subscriptionSchema = z.object({ endpoint, keys: z.object({ p256dh: base64url, auth: base64url }) });
const endpointSchema = z.object({ endpoint });

export const pushSubscriptionsRouter = Router();
pushSubscriptionsRouter.use(authenticate);

pushSubscriptionsRouter.put("/", pushSubscribeRateLimit, validateBody(subscriptionSchema), async (req, res) => {
  res.json(await savePushSubscription(authUser(req).id, req.body as SubscriptionInput, req.get("user-agent")));
});

pushSubscriptionsRouter.delete("/", validateBody(endpointSchema), async (req, res) => {
  res.json(await deletePushSubscription(authUser(req).id, (req.body as z.infer<typeof endpointSchema>).endpoint));
});
