import { z } from "zod";
import { rules } from "../../config/rules.js";
import { normalizeBdMobile } from "../../utils/phone.js";
import { passwordSchema } from "../auth/auth.validation.js";

const { profile, savedAddresses, subAreas } = rules;

// Optional text: blank means "remove" (stored as null).
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

const phone = z.string().transform((value, ctx) => {
  const normalized = normalizeBdMobile(value);
  if (!normalized) {
    ctx.addIssue({ code: "custom", message: "Enter a Bangladesh mobile number, for example 01712345678" });
    return z.NEVER;
  }
  return normalized;
});

// Email and university cannot be changed after registration (A7 decision).
export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(profile.name.minLength, "Enter your name").max(profile.name.maxLength),
    phone,
    studentIdNumber: optionalText(profile.studentIdMaxLength),
    department: optionalText(profile.departmentMaxLength),
    batch: optionalText(profile.batchMaxLength),
    location: optionalText(profile.locationMaxLength),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Change at least one field");

export const changePasswordSchema = z.object({
  // Not checked against the password rules: an old password must still work.
  currentPassword: z.string().min(1, "Enter your current password").max(200),
  newPassword: passwordSchema,
});

export const updatePreferencesSchema = z
  .object({
    language: z.enum(["BN", "EN"]),
    theme: z.enum(["LIGHT", "DARK", "SYSTEM"]),
    emailNotificationsEnabled: z.boolean(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Change at least one setting");

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

const addressFields = {
  label: z.enum(["HOME", "HALL", "WORK", "CUSTOM"]),
  customLabel: z
    .string()
    .trim()
    .min(savedAddresses.customLabel.minLength, "Enter a name for this place")
    .max(savedAddresses.customLabel.maxLength)
    .nullable()
    .optional(),
  address: z.string().trim().min(1, "Enter the address").max(savedAddresses.addressMaxLength),
  lat: latitude,
  lng: longitude,
};

// A Custom place needs its own name; Home, Hall and Work never have one.
const customNameRule = <T extends { label?: string; customLabel?: string | null }>(value: T, ctx: z.RefinementCtx) => {
  if (value.label === "CUSTOM" && !value.customLabel) {
    ctx.addIssue({ code: "custom", path: ["customLabel"], message: "Enter a name for this place" });
  }
};

export const createAddressSchema = z
  .object(addressFields)
  .strict()
  .superRefine(customNameRule)
  .transform((value) => ({ ...value, customLabel: value.label === "CUSTOM" ? value.customLabel! : null }));

export const updateAddressSchema = z
  .object(addressFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Change at least one field");

export const setSubAreasSchema = z.object({
  subAreaIds: z
    .array(z.uuid())
    .max(subAreas.maxPerUser, `Choose at most ${subAreas.maxPerUser} sub-areas`)
    .transform((ids) => [...new Set(ids)]),
});

export const subAreaSearchSchema = z.object({ q: z.string().trim().max(100).optional() });

export const idParamSchema = z.object({ id: z.uuid() });
export const userIdParamSchema = z.object({ userId: z.uuid() });

export type UpdateProfileInput = z.output<typeof updateProfileSchema>;
export type ChangePasswordInput = z.output<typeof changePasswordSchema>;
export type UpdatePreferencesInput = z.output<typeof updatePreferencesSchema>;
export type CreateAddressInput = z.output<typeof createAddressSchema>;
export type UpdateAddressInput = z.output<typeof updateAddressSchema>;
