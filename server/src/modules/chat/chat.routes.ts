import { Router } from "express";
import { z } from "zod";
import { authenticate, authUser } from "../../middleware/authenticate.js";
import { reportRateLimit } from "../../middleware/rate-limit.js";
import { singleImageUpload } from "../../middleware/upload.js";
import { parseInput, validateBody } from "../../middleware/validate.js";
import { createReport, reportSchema, type ReportInput } from "../reports/reports.service.js";
import { blockImpact, blockUser } from "../users/blocks.service.js";
import { chatForParticipant, getChat, listInbox, listMessages, markChatRead, sendImageMessage, sendTextMessage, unreadTotal } from "./chat.service.js";

// Inbox and chat over REST (proposal section 13). Real-time delivery is in
// sockets/. Every logged-in user may read their chats; sending re-checks the
// account status and the chat's state in the service. SUSPENDED and BANNED
// accounts are refused by `authenticate`.
export const chatRouter = Router();
chatRouter.use(authenticate);

const inboxQuery = z.object({ before: z.iso.datetime().optional() });
const messagesQuery = z.object({ before: z.string().trim().min(1).optional() });
const sendSchema = z.object({ body: z.string() });
const readSchema = z.object({ upTo: z.string().trim().min(1).optional() });

chatRouter.get("/", async (req, res) => {
  const { before } = parseInput(inboxQuery, req.query);
  res.json(await listInbox(authUser(req).id, before ? new Date(before) : undefined));
});

chatRouter.get("/unread-count", async (req, res) => {
  res.json({ unreadTotal: await unreadTotal(authUser(req).id) });
});

chatRouter.get("/:id", async (req, res) => {
  res.json({ chat: await getChat(authUser(req).id, String(req.params.id)) });
});

chatRouter.get("/:id/messages", async (req, res) => {
  const { before } = parseInput(messagesQuery, req.query);
  res.json(await listMessages(authUser(req).id, String(req.params.id), before));
});

chatRouter.post("/:id/messages", validateBody(sendSchema), async (req, res) => {
  const message = await sendTextMessage(authUser(req).id, String(req.params.id), (req.body as z.infer<typeof sendSchema>).body);
  res.status(201).json({ message });
});

// Food chats only. The participant check runs before the upload is read.
chatRouter.post(
  "/:id/images",
  async (req, _res, next) => {
    await chatForParticipant(authUser(req).id, String(req.params.id));
    next();
  },
  singleImageUpload("image"),
  async (req, res) => {
    const message = await sendImageMessage(authUser(req).id, String(req.params.id), req.file!.buffer);
    res.status(201).json({ message });
  },
);

chatRouter.post("/:id/read", validateBody(readSchema), async (req, res) => {
  res.json(await markChatRead(authUser(req).id, String(req.params.id), (req.body as z.infer<typeof readSchema>).upTo));
});

// Block the other participant from the chat (B2b decision 8). The client asks
// for the impact first and shows it in the confirmation sheet.
chatRouter.get("/:id/block-impact", async (req, res) => {
  const userId = authUser(req).id;
  const chat = await chatForParticipant(userId, String(req.params.id));
  const otherId = chat.activity.creatorId === userId ? chat.activity.accepterId : chat.activity.creatorId;
  res.json(await blockImpact(userId, otherId!));
});

chatRouter.post("/:id/block", async (req, res) => {
  const userId = authUser(req).id;
  const chat = await chatForParticipant(userId, String(req.params.id));
  const otherId = chat.activity.creatorId === userId ? chat.activity.accepterId : chat.activity.creatorId;
  res.json(await blockUser(userId, otherId!));
});

// Reports (B2b decision 11): from chat or, later, a profile.
export const reportsRouter = Router();
reportsRouter.use(authenticate);

reportsRouter.post("/", reportRateLimit, validateBody(reportSchema), async (req, res) => {
  res.status(201).json({ report: await createReport(authUser(req).id, req.body as ReportInput) });
});
