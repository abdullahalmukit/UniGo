import { Router, type Request } from "express";
import { z } from "zod";
import { rules } from "../../config/rules.js";
import { authenticate, authUser } from "../../middleware/authenticate.js";
import { validateBody } from "../../middleware/validate.js";
import { transitionActivity, type EngineActivity } from "./engine.js";
import type { ActivityAction } from "./transitions.js";

// Lifecycle steps shared by every feature (B2a). Accepting and booking have
// their own routes in each feature (B3 on), because their requirements differ.
// Participation and the allowed step are checked by the engine. RESTRICTED
// accounts may still start, finish, cancel and delete what they already have;
// SUSPENDED and BANNED accounts are refused by `authenticate`.
export const activitiesRouter = Router();
activitiesRouter.use(authenticate);

const { minLength, maxLength } = rules.activity.cancelReason;
const cancelSchema = z.object({
  reason: z.string().trim().min(minLength, `At least ${minLength} characters`).max(maxLength, `At most ${maxLength} characters`),
});

const view = (activity: EngineActivity) => ({
  id: activity.id,
  type: activity.type,
  status: activity.status,
  subStatus: activity.subStatus,
  startTime: activity.startTime,
});

async function act(req: Request, action: ActivityAction, reason?: string) {
  const outcome = await transitionActivity(String(req.params.id), action, { type: "USER", id: authUser(req).id }, { reason });
  return { activity: view(outcome!.activity) };
}

activitiesRouter.post("/:id/start", async (req, res) => {
  res.json(await act(req, "START"));
});

activitiesRouter.post("/:id/request-completion", async (req, res) => {
  res.json(await act(req, "REQUEST_COMPLETION"));
});

activitiesRouter.post("/:id/confirm-completion", async (req, res) => {
  res.json(await act(req, "CONFIRM_COMPLETION"));
});

activitiesRouter.post("/:id/cancel", validateBody(cancelSchema), async (req, res) => {
  res.json(await act(req, "CANCEL", (req.body as z.infer<typeof cancelSchema>).reason));
});

// Soft delete of an OPEN request by its creator (A2 decision 2)
activitiesRouter.delete("/:id", async (req, res) => {
  res.json(await act(req, "DELETE"));
});
