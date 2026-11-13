import { AppError } from "../../utils/app-error.js";
import { prisma } from "../../lib/prisma.js";

// ---- Public queries -----------------------------------------------------------

export async function listActiveSpotlight() {
  const now = new Date();
  return prisma.spotlightItem.findMany({
    where: {
      isActive: true,
      startsAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
}

export async function listActivePromos() {
  const now = new Date();
  return prisma.promo.findMany({
    where: {
      isActive: true,
      startsAt: { lte: now },
      endsAt: { gt: now },
    },
    orderBy: { startsAt: "desc" },
  });
}

export async function listActiveBanners() {
  const now = new Date();
  return prisma.banner.findMany({
    where: {
      isActive: true,
      startsAt: { lte: now },
      endsAt: { gt: now },
    },
    orderBy: [{ sortOrder: "asc" }],
  });
}

// ---- Admin CRUD — Spotlight ---------------------------------------------------

export async function adminListSpotlight() {
  return prisma.spotlightItem.findMany({ orderBy: { createdAt: "desc" } });
}

export async function adminCreateSpotlight(input: {
  title?: string;
  mediaType: "IMAGE" | "VIDEO";
  mediaUrl: string;
  linkUrl?: string;
  linkLabel?: string;
  startsAt?: Date;
  expiresAt?: Date;
  sortOrder?: number;
  isActive?: boolean;
}) {
  return prisma.spotlightItem.create({ data: input });
}

export async function adminUpdateSpotlight(
  id: string,
  input: {
    title?: string;
    mediaType?: "IMAGE" | "VIDEO";
    mediaUrl?: string;
    linkUrl?: string;
    linkLabel?: string;
    startsAt?: Date;
    expiresAt?: Date;
    sortOrder?: number;
    isActive?: boolean;
  },
) {
  const existing = await prisma.spotlightItem.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, "SPOTLIGHT_NOT_FOUND", "Spotlight item not found");
  return prisma.spotlightItem.update({ where: { id }, data: input });
}

export async function adminDeleteSpotlight(id: string) {
  const existing = await prisma.spotlightItem.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, "SPOTLIGHT_NOT_FOUND", "Spotlight item not found");
  return prisma.spotlightItem.delete({ where: { id } });
}

// ---- Admin CRUD — Promo -------------------------------------------------------

export async function adminListPromos() {
  return prisma.promo.findMany({ orderBy: { createdAt: "desc" } });
}

export async function adminCreatePromo(input: {
  title: string;
  description?: string;
  imageUrl?: string;
  promoCode?: string;
  startsAt: Date;
  endsAt: Date;
  isActive?: boolean;
}) {
  return prisma.promo.create({ data: input });
}

export async function adminUpdatePromo(
  id: string,
  input: {
    title?: string;
    description?: string;
    imageUrl?: string;
    promoCode?: string;
    startsAt?: Date;
    endsAt?: Date;
    isActive?: boolean;
  },
) {
  const existing = await prisma.promo.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, "PROMO_NOT_FOUND", "Promo not found");
  return prisma.promo.update({ where: { id }, data: input });
}

export async function adminDeletePromo(id: string) {
  const existing = await prisma.promo.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, "PROMO_NOT_FOUND", "Promo not found");
  return prisma.promo.delete({ where: { id } });
}

// ---- Admin CRUD — Banner ------------------------------------------------------

export async function adminListBanners() {
  return prisma.banner.findMany({ orderBy: { createdAt: "desc" } });
}

export async function adminCreateBanner(input: {
  title: string;
  imageUrl: string;
  linkUrl?: string;
  startsAt: Date;
  endsAt: Date;
  sortOrder?: number;
  isActive?: boolean;
}) {
  return prisma.banner.create({ data: input });
}

export async function adminUpdateBanner(
  id: string,
  input: {
    title?: string;
    imageUrl?: string;
    linkUrl?: string;
    startsAt?: Date;
    endsAt?: Date;
    sortOrder?: number;
    isActive?: boolean;
  },
) {
  const existing = await prisma.banner.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, "BANNER_NOT_FOUND", "Banner not found");
  return prisma.banner.update({ where: { id }, data: input });
}

export async function adminDeleteBanner(id: string) {
  const existing = await prisma.banner.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, "BANNER_NOT_FOUND", "Banner not found");
  return prisma.banner.delete({ where: { id } });
}

