import { rules } from "../../config/rules.js";
import type { Prisma, SupportCategory, SupportStatus } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { signPrivateFileUrl } from "../../lib/signed-files.js";
import { AppError } from "../../utils/app-error.js";
import { recordAudit } from "../admin/audit-log.js";
import { queueNotification } from "../notifications/notifications.service.js";
import { miniProfile, personSelect } from "../ride/ride.views.js";
import type { AdminReplySupportInput, CreateSupportInput, ListSupportQuery } from "./support.validation.js";

const notFound = () => new AppError(404, "SUPPORT_NOT_FOUND", "Support request not found");

export async function createSupportRequest(userId: string, input: CreateSupportInput) {
  const request = await prisma.supportRequest.create({
    data: {
      userId,
      category: input.category,
      message: input.message,
      rating: input.category === "APP_FEEDBACK" && input.rating ? input.rating : null,
      screenshotKey: input.screenshotKey ?? null,
      status: "OPEN",
    },
  });

  return request;
}

export async function listUserSupportRequests(userId: string) {
  const requests = await prisma.supportRequest.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  return requests.map((r) => ({
    id: r.id,
    category: r.category,
    message: r.message,
    rating: r.rating,
    status: r.status,
    adminReply: r.adminReply,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getUserSupportRequest(userId: string, id: string) {
  const request = await prisma.supportRequest.findUnique({
    where: { id },
  });

  if (!request || request.userId !== userId) throw notFound();

  return {
    id: request.id,
    category: request.category,
    message: request.message,
    rating: request.rating,
    status: request.status,
    adminReply: request.adminReply,
    screenshotUrl: request.screenshotKey ? await signPrivateFileUrl(request.screenshotKey) : null,
    resolvedAt: request.resolvedAt?.toISOString() ?? null,
    createdAt: request.createdAt.toISOString(),
  };
}

export async function listAdminSupportRequests(query: ListSupportQuery) {
  const pageSize = rules.support.pageSize;
  const where: Prisma.SupportRequestWhereInput = {
    ...(query.category && { category: query.category as SupportCategory }),
    ...(query.status && { status: query.status as SupportStatus }),
  };

  const [total, rows] = await Promise.all([
    prisma.supportRequest.count({ where }),
    prisma.supportRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: personSelect },
      },
    }),
  ]);

  const items = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      category: r.category,
      message: r.message,
      rating: r.rating,
      status: r.status,
      adminReply: r.adminReply,
      user: await miniProfile(r.user),
      createdAt: r.createdAt.toISOString(),
    })),
  );

  return {
    items,
    page: query.page,
    pageSize,
    total,
    hasMore: total > query.page * pageSize,
  };
}

export async function getAdminSupportRequest(id: string) {
  const request = await prisma.supportRequest.findUnique({
    where: { id },
    include: {
      user: { select: personSelect },
    },
  });

  if (!request) throw notFound();

  return {
    id: request.id,
    category: request.category,
    message: request.message,
    rating: request.rating,
    status: request.status,
    adminReply: request.adminReply,
    screenshotUrl: request.screenshotKey ? await signPrivateFileUrl(request.screenshotKey) : null,
    resolvedAt: request.resolvedAt?.toISOString() ?? null,
    user: await miniProfile(request.user),
    createdAt: request.createdAt.toISOString(),
  };
}

export async function adminReplySupport(
  adminId: string,
  id: string,
  input: AdminReplySupportInput,
  ipAddress?: string,
  now = new Date(),
) {
  const request = await prisma.supportRequest.findUnique({ where: { id } });
  if (!request) throw notFound();

  const updated = await prisma.supportRequest.update({
    where: { id },
    data: {
      status: input.status,
      adminReply: input.reply,
      handledById: adminId,
      resolvedAt: now,
    },
  });

  await recordAudit(prisma, {
    adminId,
    action: "SUPPORT_REQUEST_RESOLVED",
    targetType: "support_request",
    targetId: id,
    targetUserId: request.userId,
    oldValue: { status: request.status },
    newValue: { status: input.status, reply: input.reply },
    ipAddress,
  });

  await queueNotification({
    type: "SUPPORT_UPDATE",
    recipientId: request.userId,
    actorUserId: adminId,
    text: `Your support request has been updated: ${input.reply.slice(0, 80)}...`,
    path: `/account`,
  }).catch(() => undefined);

  return getAdminSupportRequest(id);
}

