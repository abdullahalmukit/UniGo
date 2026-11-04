import { z } from "zod";
import { rules } from "../../config/rules.js";
import { normalizeBdMobile } from "../../utils/phone.js";

const { minLength, maxLength } = rules.auth.password;

const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address").max(254));

export const passwordSchema = z
  .string()
  .min(minLength, `Password must be at least ${minLength} characters`)
  .max(maxLength, `Password must be at most ${maxLength} characters`)
  .regex(/\p{L}/u, "Password must contain a letter")
  .regex(/\p{N}/u, "Password must contain a number");

const phone = z.string().transform((value, ctx) => {
  const normalized = normalizeBdMobile(value);
  if (!normalized) {
    ctx.addIssue({ code: "custom", message: "Enter a Bangladesh mobile number, for example 01712345678" });
    return z.NEVER;
  }
  return normalized;
});

// The language and theme the browser detected at sign-up (A5b decision), so a
// Bangla browser user is not switched to English on the first login.
const preferences = {
  language: z.enum(["BN", "EN"]).optional(),
  theme: z.enum(["LIGHT", "DARK", "SYSTEM"]).optional(),
};

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(100),
  phone,
  email,
  universityId: z.uuid("Choose a university from the list"),
  password: passwordSchema,
  ...preferences,
});

export const loginSchema = z.object({
  email,
  // Not checked against the password rules: an old password must still log in.
  password: z.string().min(1, "Enter your password").max(200),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "The reset link is incomplete").max(200),
  password: passwordSchema,
});

const stepToken = z.string().min(1).max(2048);

export const googleSignInSchema = z.object({ idToken: z.string().min(1, "Missing Google ID token").max(4096) });

// Email comes from the signup token, never from the client.
export const googleRegisterSchema = registerSchema
  .pick({ name: true, phone: true, universityId: true, language: true, theme: true })
  .extend({ signupToken: stepToken });

export const googleLinkSchema = z.object({
  linkToken: stepToken,
  password: z.string().min(1, "Enter your password").max(200),
});

export type RegisterInput = z.output<typeof registerSchema>;
export type LoginInput = z.output<typeof loginSchema>;
export type GoogleRegisterInput = z.output<typeof googleRegisterSchema>;
export type GoogleLinkInput = z.output<typeof googleLinkSchema>;
