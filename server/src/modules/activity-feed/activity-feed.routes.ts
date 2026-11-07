import { Router } from "express";
import { fillPersonStats } from "../users/stats.service.js";
import { z } from "zod";
import { rules } from "../../config/rules.js";
import { authenticate, authUser } from "../../middleware/authenticate.js";
import { parseInput } from "../../middleware/validate.js";
import { rideActivity, rideUpcoming, type FeedItem } from "../ride/ride.feed.js";

// Activity (proposal 12.2) and Upcoming (12.3) across every feature. Ride
// Sharing is built (B3); Carpool, Food and Service add their items here in
// B4-B6. Every logged-in user sees only their own items.
// Mounted at /api/activity and /api/upcoming (never on /api itself, so no
// other route goes through this login check).
export const activityFeedRouter = Router();
activityFeedRouter.use(authenticate);
export const upcomingRouter = Router();
upcomingRouter.use(authenticate);

const feature = z.enum(["all", "ride", "carpool", "food", "service"]).default("all");
const role = z.enum(["all", "requested", "accepted"]).default("all");

const activityQuery = z.object({
  feature,
  role,
  tab: z.enum(["active", "ongoing", "history"]).default("active"),
  page: z.coerce.number().int().min(1).max(100).default(1),
});

const upcomingQuery = z.object({
  feature,
  role,
  limit: z.coerce.number().int().min(1).max(rules.feed.upcomingMax).default(rules.feed.upcomingMax),
});

async function itemsFor(featureName: z.infer<typeof feature>, load: () => Promise<FeedItem[]>) {
  // Only Ride Sharing has items so far
  return featureName === "all" || featureName === "ride" ? load() : [];
}

activityFeedRouter.get("/", async (req, res) => {
  const q = parseInput(activityQuery, req.query);
  const items = await itemsFor(q.feature, () => rideActivity(authUser(req).id, q.tab, q.role));
  const size = rules.feed.pageSize;
  res.json(await fillPersonStats({ items: items.slice((q.page - 1) * size, q.page * size), page: q.page, hasMore: items.length > q.page * size }));
});

upcomingRouter.get("/", async (req, res) => {
  const q = parseInput(upcomingQuery, req.query);
  const items = await itemsFor(q.feature, () => rideUpcoming(authUser(req).id, q.role));
  res.json(await fillPersonStats({ items: items.slice(0, q.limit) }));
});
