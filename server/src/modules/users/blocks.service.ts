import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { photoLink } from "./photo.js";

// Blocked Users (proposal section 5). Users block each other from chat in B2;
// here they see whom they blocked and unblock them. Only the name, photo and
// university are shown, never email or phone (A7 decision 7).

export async function listBlockedUsers(blockerId: string) {
  const rows = await prisma.block.findMany({
    where: { blockerId },
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      blocked: {
        select: {
          id: true,
          university: { select: { name: true, shortName: true } },
          profile: { select: { fullName: true, photoKey: true } },
        },
      },
    },
  });

  return Promise.all(
    rows.map(async ({ createdAt, blocked }) => ({
      id: blocked.id,
      name: blocked.profile?.fullName ?? "",
      university: blocked.university,
      photo: await photoLink(blocked.profile?.photoKey),
      blockedAt: createdAt,
    })),
  );
}

export async function unblockUser(blockerId: string, blockedId: string) {
  const { count } = await prisma.block.deleteMany({ where: { blockerId, blockedId } });
  if (count === 0) throw new AppError(404, "BLOCK_NOT_FOUND", "This user is not blocked");
}
