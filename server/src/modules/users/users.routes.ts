import { Router } from "express";
import { fillPersonStats } from "./stats.service.js";
import { z } from "zod";
import { authenticate, authUser } from "../../middleware/authenticate.js";
import { requireVerifiedStudent } from "../../middleware/authorize.js";
import { parseInput } from "../../middleware/validate.js";
import { listUserReviews } from "../reviews/reviews.service.js";
import { getPublicProfile } from "./public-profile.service.js";

// Other users' public profiles (B3b-1 G): verified students only.
export const usersRouter = Router();
usersRouter.use(authenticate, requireVerifiedStudent);

const params = z.object({ id: z.uuid() });

usersRouter.get("/:id/profile", async (req, res) => {
  const { id } = parseInput(params, req.params);
  res.json(await fillPersonStats({ profile: await getPublicProfile(authUser(req).id, id) }));
});

// B3b-2: a user's published reviews, page by page (the profile shows the first page)
const pageQuery = z.object({ page: z.coerce.number().int().min(1).max(500).default(1) });

usersRouter.get("/:id/reviews", async (req, res) => {
  const { id } = parseInput(params, req.params);
  // Same access rules as the profile (blocked users, banned accounts)
  await getPublicProfile(authUser(req).id, id);
  res.json(await listUserReviews(id, parseInput(pageQuery, req.query).page));
});
