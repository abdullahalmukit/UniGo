import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { requireRole } from "../../middleware/authorize.js";
import { validateBody } from "../../middleware/validate.js";
import {
  adminCreateBanner,
  adminCreatePromo,
  adminCreateSpotlight,
  adminDeleteBanner,
  adminDeletePromo,
  adminDeleteSpotlight,
  adminListBanners,
  adminListPromos,
  adminListSpotlight,
  adminUpdateBanner,
  adminUpdatePromo,
  adminUpdateSpotlight,
  listActiveBanners,
  listActivePromos,
  listActiveSpotlight,
} from "./content.service.js";

export const contentRouter = Router();

const id = (value: unknown) => String(value);

// ---- Public endpoints ---------------------------------------------------------

contentRouter.get("/spotlight", async (_req, res) => {
  res.json(await listActiveSpotlight());
});

contentRouter.get("/promos", async (_req, res) => {
  res.json(await listActivePromos());
});

contentRouter.get("/banners", async (_req, res) => {
  res.json(await listActiveBanners());
});

// ---- Admin CRUD ---------------------------------------------------------------

const adminContent = Router();
adminContent.use(authenticate, requireRole("MODERATOR", "SUPER_ADMIN"));

// Spotlight schemas
const spotlightCreateSchema = z.object({
  title: z.string().trim().max(150).optional(),
  mediaType: z.enum(["IMAGE", "VIDEO"]),
  mediaUrl: z.string().trim().min(1).max(512),
  linkUrl: z.string().trim().max(512).optional(),
  linkLabel: z.string().trim().max(50).optional(),
  startsAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
  sortOrder: z.coerce.number().int().optional(),
  isActive: z.boolean().optional(),
});
const spotlightUpdateSchema = spotlightCreateSchema.partial().extend({
  mediaType: z.enum(["IMAGE", "VIDEO"]).optional(),
  mediaUrl: z.string().trim().min(1).max(512).optional(),
});

// Promo schemas
const promoCreateSchema = z.object({
  title: z.string().trim().min(1).max(150),
  description: z.string().trim().optional(),
  imageUrl: z.string().trim().max(512).optional(),
  promoCode: z.string().trim().max(50).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  isActive: z.boolean().optional(),
});
const promoUpdateSchema = promoCreateSchema.partial();

// Banner schemas
const bannerCreateSchema = z.object({
  title: z.string().trim().min(1).max(150),
  imageUrl: z.string().trim().min(1).max(512),
  linkUrl: z.string().trim().max(512).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  sortOrder: z.coerce.number().int().optional(),
  isActive: z.boolean().optional(),
});
const bannerUpdateSchema = bannerCreateSchema.partial();

// Spotlight CRUD
adminContent.get("/spotlight", async (_req, res) => {
  res.json(await adminListSpotlight());
});
adminContent.post("/spotlight", validateBody(spotlightCreateSchema), async (req, res) => {
  res.status(201).json(await adminCreateSpotlight(req.body as z.infer<typeof spotlightCreateSchema>));
});
adminContent.patch("/spotlight/:id", validateBody(spotlightUpdateSchema), async (req, res) => {
  res.json(await adminUpdateSpotlight(id(req.params.id), req.body as z.infer<typeof spotlightUpdateSchema>));
});
adminContent.delete("/spotlight/:id", async (req, res) => {
  await adminDeleteSpotlight(id(req.params.id));
  res.status(204).end();
});

// Promo CRUD
adminContent.get("/promos", async (_req, res) => {
  res.json(await adminListPromos());
});
adminContent.post("/promos", validateBody(promoCreateSchema), async (req, res) => {
  res.status(201).json(await adminCreatePromo(req.body as z.infer<typeof promoCreateSchema>));
});
adminContent.patch("/promos/:id", validateBody(promoUpdateSchema), async (req, res) => {
  res.json(await adminUpdatePromo(id(req.params.id), req.body as z.infer<typeof promoUpdateSchema>));
});
adminContent.delete("/promos/:id", async (req, res) => {
  await adminDeletePromo(id(req.params.id));
  res.status(204).end();
});

// Banner CRUD
adminContent.get("/banners", async (_req, res) => {
  res.json(await adminListBanners());
});
adminContent.post("/banners", validateBody(bannerCreateSchema), async (req, res) => {
  res.status(201).json(await adminCreateBanner(req.body as z.infer<typeof bannerCreateSchema>));
});
adminContent.patch("/banners/:id", validateBody(bannerUpdateSchema), async (req, res) => {
  res.json(await adminUpdateBanner(id(req.params.id), req.body as z.infer<typeof bannerUpdateSchema>));
});
adminContent.delete("/banners/:id", async (req, res) => {
  await adminDeleteBanner(id(req.params.id));
  res.status(204).end();
});

export {
  adminContent as adminContentRouter,
  bannerCreateSchema,
  bannerUpdateSchema,
  promoCreateSchema,
  promoUpdateSchema,
  spotlightCreateSchema,
  spotlightUpdateSchema,
};

