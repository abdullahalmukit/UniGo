import { Router } from "express";
import { z } from "zod";
import { authenticate, authUser } from "../../middleware/authenticate.js";
import { requireCanAct, requireVerifiedStudent } from "../../middleware/authorize.js";
import { fareEstimateRateLimit } from "../../middleware/rate-limit.js";
import { parseInput, validateBody } from "../../middleware/validate.js";
import { estimateFare } from "./fare.service.js";
import {
  acceptRideRequest,
  bookRideOffer,
  cancelRideOffer,
  createRideOffer,
  createRideRequest,
  getRideBooking,
  getRideOffer,
  getRideRequest,
  listRides,
  removeRideOffer,
  rideConfig,
  stopOfferBookings,
  updateRideOffer,
  updateRideRequest,
  upgradeRideRequest,
} from "./ride.service.js";
import {
  acceptSchema,
  bookSchema,
  cancelOfferSchema,
  fareQuery,
  listQuery,
  offerEditSchema,
  offerSchema,
  requestEditSchema,
  requestSchema,
  upgradeSchema,
  type OfferEditInput,
  type OfferInput,
  type RequestEditInput,
  type RequestInput,
} from "./ride.validation.js";

// Ride Sharing (proposal section 8). Verified students only; RESTRICTED
// accounts cannot create, accept or book (requireCanAct) but can still see,
// cancel and finish what they have. Start, completion and cancelling a
// booking or an accepted request use /api/activities (B2a); deleting an OPEN
// request is DELETE /api/activities/:id.
export const rideRouter = Router();
rideRouter.use(authenticate, requireVerifiedStudent);

const id = (value: unknown) => String(value);
const me = (req: Parameters<typeof authUser>[0]) => authUser(req).id;

rideRouter.get("/config", (_req, res) => {
  res.json(rideConfig());
});

rideRouter.get("/", async (req, res) => {
  res.json(await listRides(me(req), parseInput(listQuery, req.query)));
});

// Suggested fare (8.2). Limited per account: the route server is a public one.
rideRouter.get("/fare-estimate", fareEstimateRateLimit, async (req, res) => {
  const q = parseInput(fareQuery, req.query);
  res.json(await estimateFare({ lat: q.fromLat, lng: q.fromLng }, { lat: q.toLat, lng: q.toLng }));
});

// --- Passenger requests

rideRouter.post("/requests", requireCanAct, validateBody(requestSchema), async (req, res) => {
  res.status(201).json({ request: await createRideRequest(me(req), req.body as RequestInput) });
});

rideRouter.get("/requests/:id", async (req, res) => {
  res.json({ request: await getRideRequest(me(req), id(req.params.id)) });
});

rideRouter.patch("/requests/:id", requireCanAct, validateBody(requestEditSchema), async (req, res) => {
  res.json({ request: await updateRideRequest(me(req), id(req.params.id), req.body as RequestEditInput) });
});

rideRouter.post("/requests/:id/upgrade", requireCanAct, validateBody(upgradeSchema), async (req, res) => {
  res.json({ request: await upgradeRideRequest(me(req), id(req.params.id), (req.body as z.infer<typeof upgradeSchema>).offeredAmount) });
});

rideRouter.post("/requests/:id/accept", requireCanAct, validateBody(acceptSchema), async (req, res) => {
  res.json({ request: await acceptRideRequest(me(req), id(req.params.id), (req.body as z.infer<typeof acceptSchema>).vehicleId) });
});

// --- Ride offers

rideRouter.post("/offers", requireCanAct, validateBody(offerSchema), async (req, res) => {
  res.status(201).json({ offer: await createRideOffer(me(req), req.body as OfferInput) });
});

rideRouter.get("/offers/:id", async (req, res) => {
  res.json({ offer: await getRideOffer(me(req), id(req.params.id)) });
});

rideRouter.patch("/offers/:id", requireCanAct, validateBody(offerEditSchema), async (req, res) => {
  res.json({ offer: await updateRideOffer(me(req), id(req.params.id), req.body as OfferEditInput) });
});

rideRouter.post("/offers/:id/stop", async (req, res) => {
  res.json({ offer: await stopOfferBookings(me(req), id(req.params.id)) });
});

rideRouter.post("/offers/:id/cancel", validateBody(cancelOfferSchema), async (req, res) => {
  res.json({ offer: await cancelRideOffer(me(req), id(req.params.id), (req.body as z.infer<typeof cancelOfferSchema>).reason) });
});

rideRouter.delete("/offers/:id", async (req, res) => {
  res.json({ offer: await removeRideOffer(me(req), id(req.params.id)) });
});

rideRouter.post("/offers/:id/bookings", requireCanAct, validateBody(bookSchema), async (req, res) => {
  res.status(201).json({ booking: await bookRideOffer(me(req), id(req.params.id), (req.body as z.infer<typeof bookSchema>).seats) });
});

rideRouter.get("/bookings/:activityId", async (req, res) => {
  res.json({ booking: await getRideBooking(me(req), id(req.params.activityId)) });
});
