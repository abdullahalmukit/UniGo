import type { TFunction } from "i18next";
import { ApiError } from "../../lib/api";
import type { FormErrors } from "../../lib/errors";

// The application form's errors. The server names vehicle fields with their
// place in the list ("vehicles.1.registrationNumber"); each message is
// translated by the last part of that name, and kept under the full name so
// it shows under the right vehicle.
export function applicationErrors(error: unknown, t: TFunction): FormErrors {
  if (!(error instanceof ApiError)) return { fields: {}, form: t("errors.NETWORK") };

  if (error.fields && Object.keys(error.fields).length > 0) {
    const fields: Record<string, string> = {};
    for (const [name, messages] of Object.entries(error.fields)) {
      const last = name.split(".").at(-1)!;
      fields[name] =
        error.code === "VALIDATION_ERROR"
          ? t(`rider.fieldErrors.${last}`, { defaultValue: messages[0] })
          : t(`errors.${error.code}`, { defaultValue: messages[0] });
    }
    return { fields };
  }
  return { fields: {}, form: t(`errors.${error.code}`, { defaultValue: t("errors.generic") }) };
}
