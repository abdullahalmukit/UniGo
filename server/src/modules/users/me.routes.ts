import { Router } from "express";
import { rules } from "../../config/rules.js";
import { authenticate, authUser } from "../../middleware/authenticate.js";
import { passwordSetupLinkRateLimit } from "../../middleware/rate-limit.js";
import { singleImageUpload } from "../../middleware/upload.js";
import { parseInput, validateBody } from "../../middleware/validate.js";
import { getMySubAreas, setMySubAreas } from "../subareas/subareas.service.js";
import { listBlockedUsers, unblockUser } from "./blocks.service.js";
import {
  removeProfilePhoto,
  requestPasswordSetupLink,
  setProfilePhoto,
  updatePreferences,
  updateProfile,
} from "./profile.service.js";
import { createAddress, deleteAddress, listAddresses, updateAddress } from "./saved-addresses.service.js";
import {
  createAddressSchema,
  idParamSchema,
  setSubAreasSchema,
  updateAddressSchema,
  updatePreferencesSchema,
  updateProfileSchema,
  userIdParamSchema,
} from "./users.validation.js";

// The logged-in user's own profile and settings (proposal section 5, A7).
// Open to every logged-in user, verified or not and RESTRICTED too: completing
// the profile is what an unverified user is allowed to do. SUSPENDED and BANNED
// accounts are refused by `authenticate`.
export const meRouter = Router();
meRouter.use(authenticate);

meRouter.patch("/profile", validateBody(updateProfileSchema), async (req, res) => {
  res.json({ user: await updateProfile(authUser(req).id, req.body) });
});

meRouter.put("/photo", singleImageUpload("photo"), async (req, res) => {
  res.json({ user: await setProfilePhoto(authUser(req).id, req.file!.buffer) });
});

meRouter.delete("/photo", async (req, res) => {
  res.json({ user: await removeProfilePhoto(authUser(req).id) });
});

meRouter.post("/password-setup-link", passwordSetupLinkRateLimit, async (req, res) => {
  await requestPasswordSetupLink(authUser(req).id);
  res.status(202).json({ message: "A link to set your password has been sent to your email" });
});

meRouter.patch("/preferences", validateBody(updatePreferencesSchema), async (req, res) => {
  res.json({ user: await updatePreferences(authUser(req).id, req.body) });
});

meRouter.get("/addresses", async (req, res) => {
  // `max` comes from rules.ts, so the page never hard-codes the limit.
  res.json({ addresses: await listAddresses(authUser(req).id), max: rules.savedAddresses.maxPerUser });
});

meRouter.post("/addresses", validateBody(createAddressSchema), async (req, res) => {
  res.status(201).json({ address: await createAddress(authUser(req).id, req.body) });
});

meRouter.patch("/addresses/:id", validateBody(updateAddressSchema), async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  res.json({ address: await updateAddress(authUser(req).id, id, req.body) });
});

meRouter.delete("/addresses/:id", async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  await deleteAddress(authUser(req).id, id);
  res.status(204).end();
});

meRouter.get("/sub-areas", async (req, res) => {
  res.json({ subAreas: await getMySubAreas(authUser(req).id), max: rules.subAreas.maxPerUser });
});

meRouter.put("/sub-areas", validateBody(setSubAreasSchema), async (req, res) => {
  res.json({ subAreas: await setMySubAreas(authUser(req).id, req.body.subAreaIds), max: rules.subAreas.maxPerUser });
});

meRouter.get("/blocks", async (req, res) => {
  res.json({ users: await listBlockedUsers(authUser(req).id) });
});

meRouter.delete("/blocks/:userId", async (req, res) => {
  const { userId } = parseInput(userIdParamSchema, req.params);
  await unblockUser(authUser(req).id, userId);
  res.status(204).end();
});
