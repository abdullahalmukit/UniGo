import { z } from "zod";
import { rules } from "../../config/rules.js";
import { emailSchema } from "../auth/auth.validation.js";

const { otpLength, rejectionReason } = rules.studentVerification;

export const sendOtpSchema = z.object({ email: emailSchema });

export const confirmOtpSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{${otpLength}}$`), `Enter the ${otpLength}-digit code`),
});

export const rejectSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(rejectionReason.minLength, `Give a reason of at least ${rejectionReason.minLength} characters`)
    .max(rejectionReason.maxLength, `The reason must be at most ${rejectionReason.maxLength} characters`),
});

export type SendOtpInput = z.infer<typeof sendOtpSchema>;
export type ConfirmOtpInput = z.infer<typeof confirmOtpSchema>;
