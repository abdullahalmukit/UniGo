import { Router } from "express";
import { fillPersonStats } from "../users/stats.service.js";
import { z } from "zod";
import { rules } from "../../config/rules.js";
import { authenticate, authUser } from "../../middleware/authenticate.js";
import { parseInput } from "../../middleware/validate.js";
import { foodActivity, foodUpcoming } from "../food/food.feed.js";
import { rideActivity, rideUpcoming, type FeedItem } from "../ride/ride.feed.js";

// Activity (proposal 12.2) and Upcoming (12.3) across every feature. Ride
// Sharing (B3) and Food (B4) are built; Carpool and Service add their items
// here in B5-B6. Every logged-in user sees only their own items.
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

type Loaders = { ride: () => Promise<FeedItem[]>; food: () => Promise<FeedItem[]> };

// The features that have items so far (Ride B3, Food B4), merged by time.
async function itemsFor(featureName: z.infer<typeof feature>, load: Loaders, newestFirst: boolean) {
  const parts = await Promise.all([
    featureName === "all" || featureName === "ride" ? load.ride() : [],
    featureName === "all" || featureName === "food" ? load.food() : [],
  ]);
  return parts.flat().sort((a, b) => (newestFirst ? b.time.getTime() - a.time.getTime() : a.time.getTime() - b.time.getTime()));
}

activityFeedRouter.get("/", async (req, res) => {
  const q = parseInput(activityQuery, req.query);
  const userId = authUser(req).id;
  const items = await itemsFor(
    q.feature,
    { ride: () => rideActivity(userId, q.tab, q.role), food: () => foodActivity(userId, q.tab, q.role) },
    q.tab === "history",
  );
  const size = rules.feed.pageSize;
  res.json(await fillPersonStats({ items: items.slice((q.page - 1) * size, q.page * size), page: q.page, hasMore: items.length > q.page * size }));
});

upcomingRouter.get("/", async (req, res) => {
  const q = parseInput(upcomingQuery, req.query);
  const userId = authUser(req).id;
  const items = await itemsFor(q.feature, { ride: () => rideUpcoming(userId, q.role), food: () => foodUpcoming(userId, q.role) }, false);
  res.json(await fillPersonStats({ items: items.slice(0, q.limit) }));
});
