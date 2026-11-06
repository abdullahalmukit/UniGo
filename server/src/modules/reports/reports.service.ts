import { z } from "zod";
import { rules } from "../../config/rules.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";

// Reports from chat or a profile (proposal 13 and 15.4, B2b decision 11).
// Stored for the admin review screen in B7. When an activity is given, the
// reporter must take part in it and the reported user is the other
// participant; a message must be in that activity's chat and sent by them.

const { reasons, descriptionMaxLength } = rules.reports;

export const reportSchema = z
  .object({
    reason: z.enum(reasons),
    description: z.string().trim().max(descriptionMaxLength).optional(),
    activityId: z.string().trim().min(1).optional(),
    messageId: z.string().trim().min(1).optional(),
    reportedUserId: z.string().trim().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.reason === "OTHER" && (value.description?.length ?? 0) < 3) {
      ctx.addIssue({ code: "custom", path: ["description"], message: "Describe the problem" });
    }
    if (!value.activityId && !value.reportedUserId) {
      ctx.addIssue({ code: "custom", path: ["reportedUserId"], message: "Choose whom to report" });
    }
    if (value.messageId && !value.activityId) {
      ctx.addIssue({ code: "custom", path: ["activityId"], message: "A message is reported with its activity" });
    }
  });

export type ReportInput = z.infer<typeof reportSchema>;

export async function createReport(reporterId: string, input: ReportInput) {
  let reportedUserId = input.reportedUserId;

  if (input.activityId) {
    const activity = await prisma.activity.findUnique({
      where: { id: input.activityId },
      select: { creatorId: true, accepterId: true, chat: { select: { id: true } } },
    });
    if (!activity || (activity.creatorId !== reporterId && activity.accepterId !== reporterId)) {
      throw new AppError(403, "NOT_PARTICIPANT", "You are not part of this activity");
    }
    const other = activity.creatorId === reporterId ? activity.accepterId : activity.creatorId;
    if (!other || (reportedUserId && reportedUserId !== other)) {
      throw new AppError(400, "VALIDATION_ERROR", "Some fields are invalid", { fields: { reportedUserId: ["Not the other participant"] } });
    }
    reportedUserId = other;

    if (input.messageId) {
      const message = await prisma.message.findUnique({ where: { id: input.messageId }, select: { chatId: true, senderId: true } });
      if (!message || message.chatId !== activity.chat?.id || message.senderId !== other) {
        throw new AppError(400, "VALIDATION_ERROR", "Some fields are invalid", { fields: { messageId: ["Not a message from this user"] } });
      }
    }
  }

  if (!reportedUserId || reportedUserId === reporterId) {
    throw new AppError(400, "CANNOT_REPORT_SELF", "You cannot report yourself");
  }
  const reported = await prisma.user.findUnique({ where: { id: reportedUserId }, select: { id: true } });
  if (!reported) throw new AppError(404, "USER_NOT_FOUND", "User not found");

  const report = await prisma.report.create({
    data: {
      reporterId,
      reportedUserId,
      activityId: input.activityId ?? null,
      messageId: input.messageId ?? null,
      reason: input.reason,
      description: input.description || null,
    },
    select: { id: true, status: true, createdAt: true },
  });
  return report;
}
