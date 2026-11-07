import { Router } from "express";
import { z } from "zod";
import { authenticate, authUser } from "../../middleware/authenticate.js";
import { requireCanAct, requireVerifiedStudent } from "../../middleware/authorize.js";
import { parseInput, validateBody } from "../../middleware/validate.js";
import { fillPersonStats } from "../users/stats.service.js";
import {
  acceptCarpoolBooking,
  addCarpoolSeats,
  agreeCarpoolBooking,
  carpoolConfig,
  createCarpoolPost,
  getCarpoolBooking,
  getCarpoolPost,
  quoteCarpoolBooking,
  rejectCarpoolBooking,
  removeCarpoolPost,
  requestCarpoolBooking,
  searchCarpools,
  setCarpoolPaused,
  updateCarpoolPost,
  withdrawCarpoolBooking,
} from "./carpool.service.js";
import {
  bookingSchema,
  postEditSchema,
  postSchema,
  quoteQuery,
  rejectSchema,
  searchQuery,
  seatsSchema,
  type BookingInput,
  type PostEditInput,
  type PostInput,
} from "./carpool.validation.js";

// Carpool (proposal section 9, B6a). Verified students only; RESTRICTED
// accounts cannot create, request, accept or agree (requireCanAct) but can
// still see their items, reject, withdraw and cancel. Cancelling a held seat
// uses POST /api/activities/:id/cancel (B2a). My Carpool Posts and My
// Bookings are the Activity feed with feature=carpool (B3b-1).
export const carpoolRouter = Router();
carpoolRouter.use(authenticate, requireVerifiedStudent);

const id = (value: unknown) => String(value);
const me = (req: Parameters<typeof authUser>[0]) => authUser(req).id;

carpoolRouter.get("/config", (_req, res) => {
  res.json(carpoolConfig());
});

carpoolRouter.get("/", async (req, res) => {
  res.json(await fillPersonStats(await searchCarpools(me(req), parseInput(searchQuery, req.query))));
});

// --- Posts (Active riders)

carpoolRouter.post("/posts", requireCanAct, validateBody(postSchema), async (req, res) => {
  res.status(201).json(await fillPersonStats({ post: await createCarpoolPost(me(req), req.body as PostInput) }));
});

carpoolRouter.get("/posts/:id", async (req, res) => {
  res.json(await fillPersonStats({ post: await getCarpoolPost(me(req), id(req.params.id)) }));
});

carpoolRouter.patch("/posts/:id", requireCanAct, validateBody(postEditSchema), async (req, res) => {
  res.json(await fillPersonStats({ post: await updateCarpoolPost(me(req), id(req.params.id), req.body as PostEditInput) }));
});

carpoolRouter.post("/posts/:id/seats", requireCanAct, validateBody(seatsSchema), async (req, res) => {
  res.json(await fillPersonStats({ post: await addCarpoolSeats(me(req), id(req.params.id), (req.body as z.infer<typeof seatsSchema>).seats) }));
});

carpoolRouter.post("/posts/:id/pause", async (req, res) => {
  res.json(await fillPersonStats({ post: await setCarpoolPaused(me(req), id(req.params.id), true) }));
});

carpoolRouter.post("/posts/:id/resume", requireCanAct, async (req, res) => {
  res.json(await fillPersonStats({ post: await setCarpoolPaused(me(req), id(req.params.id), false) }));
});

carpoolRouter.delete("/posts/:id", async (req, res) => {
  res.json(await fillPersonStats({ post: await removeCarpoolPost(me(req), id(req.params.id)) }));
});

carpoolRouter.get("/posts/:id/quote", async (req, res) => {
  res.json(await quoteCarpoolBooking(id(req.params.id), parseInput(quoteQuery, req.query)));
});

// --- Booking requests, held seats and contracts

carpoolRouter.post("/posts/:id/bookings", requireCanAct, validateBody(bookingSchema), async (req, res) => {
  res.status(201).json(await fillPersonStats({ booking: await requestCarpoolBooking(me(req), id(req.params.id), req.body as BookingInput) }));
});

carpoolRouter.get("/bookings/:activityId", async (req, res) => {
  res.json(await fillPersonStats({ booking: await getCarpoolBooking(me(req), id(req.params.activityId)) }));
});

carpoolRouter.post("/bookings/:activityId/accept", requireCanAct, async (req, res) => {
  res.json(await fillPersonStats({ booking: await acceptCarpoolBooking(me(req), id(req.params.activityId)) }));
});

carpoolRouter.post("/bookings/:activityId/reject", validateBody(rejectSchema), async (req, res) => {
  const reason = (req.body as z.infer<typeof rejectSchema>).reason ?? null;
  res.json(await fillPersonStats({ booking: await rejectCarpoolBooking(me(req), id(req.params.activityId), reason) }));
});

carpoolRouter.post("/bookings/:activityId/withdraw", async (req, res) => {
  res.json(await fillPersonStats({ booking: await withdrawCarpoolBooking(me(req), id(req.params.activityId)) }));
});

carpoolRouter.post("/bookings/:activityId/agree", requireCanAct, async (req, res) => {
  res.json(await fillPersonStats({ booking: await agreeCarpoolBooking(me(req), id(req.params.activityId)) }));
});
