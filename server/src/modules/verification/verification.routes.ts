import { Router } from "express";
import { authenticate, authUser } from "../../middleware/authenticate.js";
import {
  checkOtpRateLimit,
  idCardUploadRateLimit,
  sendOtpIpRateLimit,
  sendOtpUserRateLimit,
} from "../../middleware/rate-limit.js";
import { singleDocumentUpload } from "../../middleware/upload.js";
import { validateBody } from "../../middleware/validate.js";
import type { AllowedMimeType } from "../../utils/file-type.js";
import { confirmOtpSchema, sendOtpSchema, type ConfirmOtpInput, type SendOtpInput } from "./verification.validation.js";
import { confirmEmailOtp, getStudentVerification, sendEmailOtp, submitIdCard } from "./verification.service.js";

// Logged-in users only, verified or not: verification is what unverified users
// are allowed to do. The rate limits count per account, so they run after login.
export const verificationRouter = Router();
verificationRouter.use(authenticate);

verificationRouter.get("/student", async (req, res) => {
  res.json(await getStudentVerification(authUser(req).id));
});

verificationRouter.post(
  "/student/email/send",
  sendOtpIpRateLimit,
  sendOtpUserRateLimit,
  validateBody(sendOtpSchema),
  async (req, res) => {
    const { email } = req.body as SendOtpInput;
    res.json(await sendEmailOtp(authUser(req).id, email));
  },
);

verificationRouter.post("/student/email/confirm", checkOtpRateLimit, validateBody(confirmOtpSchema), async (req, res) => {
  const userId = authUser(req).id;
  await confirmEmailOtp(userId, (req.body as ConfirmOtpInput).code);
  res.json(await getStudentVerification(userId));
});

verificationRouter.post("/student/id-card", idCardUploadRateLimit, singleDocumentUpload("file"), async (req, res) => {
  const userId = authUser(req).id;
  const file = req.file!;
  await submitIdCard(userId, { buffer: file.buffer, mimeType: file.mimetype as AllowedMimeType });
  res.status(201).json(await getStudentVerification(userId));
});
