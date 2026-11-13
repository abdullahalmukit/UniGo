import { Router } from "express";
import { userFromAccessToken } from "../../middleware/authenticate.js";
import { parseInput } from "../../middleware/validate.js";
import { listAllOpenRequests } from "./all-requests.service.js";
import { allRequestsQuery } from "./all-requests.validation.js";

export const allRequestsRouter = Router();

// Public: Guests can view open requests feed. Authenticated users see personalized details (e.g. mine, blocked filtering).
allRequestsRouter.get("/", async (req, res) => {
  const query = parseInput(allRequestsQuery, req.query);
  let viewerId: string | null = null;

  const header = req.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (token) {
    try {
      const { user } = await userFromAccessToken(token);
      viewerId = user.id;
    } catch {
      // Ignored for guest access
    }
  }

  const result = await listAllOpenRequests(viewerId, query);
  res.json(result);
});

