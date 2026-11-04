import { rules } from "../../config/rules.js";
import type { Prisma, SavedAddressLabel } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import type { CreateAddressInput, UpdateAddressInput } from "./users.validation.js";

// Saved Addresses (proposal section 5, A7 decision): Home, Hall and Work at
// most once each, Custom places with their own name, at most
// rules.savedAddresses.maxPerUser in total. Used later to prefill forms.

const { maxPerUser, singleLabels } = rules.savedAddresses;

const addressSelect = {
  id: true,
  label: true,
  customLabel: true,
  address: true,
  lat: true,
  lng: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SavedAddressSelect;

type AddressRow = Prisma.SavedAddressGetPayload<{ select: typeof addressSelect }>;

const LABEL_ORDER: Record<SavedAddressLabel, number> = { HOME: 0, HALL: 1, WORK: 2, CUSTOM: 3 };

const toAddress = (row: AddressRow) => ({ ...row, lat: row.lat.toNumber(), lng: row.lng.toNumber() });

export async function listAddresses(userId: string) {
  const rows = await prisma.savedAddress.findMany({ where: { userId }, select: addressSelect, orderBy: { createdAt: "asc" } });
  return rows.sort((a, b) => LABEL_ORDER[a.label] - LABEL_ORDER[b.label]).map(toAddress);
}

// The user row is locked first, so two requests at once cannot both pass the
// count or the one-Home check.
export async function createAddress(userId: string, input: CreateAddressInput) {
  const row = await prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const existing = await tx.savedAddress.findMany({ where: { userId }, select: { label: true } });
    if (existing.length >= maxPerUser) {
      throw new AppError(409, "ADDRESS_LIMIT_REACHED", `You can save at most ${maxPerUser} addresses`);
    }
    if (isSingle(input.label) && existing.some(({ label }) => label === input.label)) throw labelTaken();
    return tx.savedAddress.create({ data: { userId, ...input }, select: addressSelect });
  });
  return toAddress(row);
}

export async function updateAddress(userId: string, id: string, input: UpdateAddressInput) {
  const row = await prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const current = await tx.savedAddress.findFirst({ where: { id, userId }, select: { label: true, customLabel: true } });
    if (!current) throw notFound();

    const label = input.label ?? current.label;
    const customLabel = label === "CUSTOM" ? (input.customLabel ?? current.customLabel) : null;
    if (label === "CUSTOM" && !customLabel) {
      throw new AppError(400, "VALIDATION_ERROR", "Some fields are invalid", {
        fields: { customLabel: ["Enter a name for this place"] },
      });
    }
    if (isSingle(label) && label !== current.label) {
      const taken = await tx.savedAddress.count({ where: { userId, label, id: { not: id } } });
      if (taken > 0) throw labelTaken();
    }

    return tx.savedAddress.update({ where: { id }, data: { ...input, label, customLabel }, select: addressSelect });
  });
  return toAddress(row);
}

export async function deleteAddress(userId: string, id: string) {
  const { count } = await prisma.savedAddress.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound();
}

const isSingle = (label: SavedAddressLabel) => (singleLabels as readonly string[]).includes(label);

async function lockUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
}

function labelTaken() {
  return new AppError(409, "ADDRESS_LABEL_TAKEN", "You already saved this place. Edit it instead", {
    fields: { label: ["You already saved this place"] },
  });
}

// Another user's address looks exactly like a missing one.
function notFound() {
  return new AppError(404, "ADDRESS_NOT_FOUND", "Address not found");
}
