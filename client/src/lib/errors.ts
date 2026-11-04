import type { TFunction } from "i18next";
import { ApiError } from "./api";

export type FieldErrors = Record<string, string>;
export type FormErrors = { fields: FieldErrors; form?: string };

// Codes that belong under one field rather than at the top of the form.
const FIELD_CODES: Record<string, string> = {
  EMAIL_TAKEN: "email",
  PHONE_TAKEN: "phone",
  UNIVERSITY_NOT_FOUND: "universityId",
};

// Turns any error from an API call into translated messages: one per field
// (server VALIDATION_ERROR fields and field-specific codes) and one for the form.
// Server field messages are English, so each field gets its own translated
// message instead (errors.fields.<field>).
export function formErrors(error: unknown, t: TFunction): FormErrors {
  if (!(error instanceof ApiError)) return { fields: {}, form: t("errors.NETWORK") };

  if (error.code === "VALIDATION_ERROR" && error.fields) {
    const fields: FieldErrors = {};
    for (const field of Object.keys(error.fields)) {
      fields[field] = t(`errors.fields.${field}`, { defaultValue: error.fields[field][0] });
    }
    return { fields };
  }

  const field = FIELD_CODES[error.code];
  const message = t(`errors.${error.code}`, { defaultValue: t("errors.generic") });
  return field ? { fields: { [field]: message } } : { fields: {}, form: message };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The only checks done in the browser (A5b decision): required fields and the
// email format. Every other rule is checked by the server.
export function checkRequired(values: Record<string, string>, required: string[], t: TFunction): FieldErrors {
  const fields: FieldErrors = {};
  for (const name of required) {
    if (!values[name]?.trim()) fields[name] = t("errors.required");
  }
  if (values.email?.trim() && !EMAIL.test(values.email.trim())) fields.email = t("errors.fields.email");
  return fields;
}
