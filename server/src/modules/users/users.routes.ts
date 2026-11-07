import { Router } from "express";
import { z } from "zod";
import { authenticate, authUser } from "../../middleware/authenticate.js";
import { requireVerifiedStudent } from "../../middleware/authorize.js";
import { parseInput } from "../../middleware/validate.js";
import { getPublicProfile } from "./public-profile.service.js";

// Other users' public profiles (B3b-1 G): verified students only.
export const usersRouter = Router();
usersRouter.use(authenticate, requireVerifiedStudent);

const params = z.object({ id: z.uuid() });

usersRouter.get("/:id/profile", async (req, res) => {
  const { id } = parseInput(params, req.params);
  res.json({ profile: await getPublicProfile(authUser(req).id, id) });
});
