import { describe, expect, it } from "vitest";
import { i18n } from "../i18n";
import { ApiError } from "./api";
import { checkRequired, formErrors } from "./errors";

const t = i18n.t.bind(i18n);

describe("formErrors", () => {
  it("translates each field of a VALIDATION_ERROR instead of showing the server's English", () => {
    const error = new ApiError(400, {
      code: "VALIDATION_ERROR",
      message: "Some fields are invalid",
      fields: { phone: ["Enter a Bangladesh mobile number"], password: ["Password must contain a number"] },
    });

    expect(formErrors(error, t)).toEqual({
      fields: {
        phone: "Enter a Bangladesh mobile number, for example 01712345678.",
        password: "Use 8–72 characters, with at least one letter and one number.",
      },
    });
  });

  it.each([
    ["EMAIL_TAKEN", "email"],
    ["PHONE_TAKEN", "phone"],
    ["UNIVERSITY_NOT_FOUND", "universityId"],
  ])("puts %s under the %s field", (code, field) => {
    expect(formErrors(new ApiError(409, { code }), t).fields).toHaveProperty(field);
  });

  it.each([
    ["INVALID_CREDENTIALS", "Email or password is incorrect."],
    ["ACCOUNT_SUSPENDED", "This account is suspended. Contact UniGo support if you think this is a mistake."],
    ["RATE_LIMITED", "Too many attempts. Wait a few minutes and try again."],
    ["SOMETHING_NEW", "Something went wrong. Try again."],
  ])("shows %s at the top of the form", (code, message) => {
    expect(formErrors(new ApiError(401, { code }), t)).toEqual({ fields: {}, form: message });
  });

  it("explains a network failure", () => {
    expect(formErrors(new TypeError("Failed to fetch"), t).form).toBe(
      "Can't reach UniGo. Check your connection and try again.",
    );
  });
});

describe("checkRequired", () => {
  it("only checks required fields and the email format", () => {
    expect(checkRequired({ email: "nope", password: "", phone: "123" }, ["email", "password", "phone"], t)).toEqual({
      email: "Enter a valid email address.",
      password: "Fill in this field.",
    });
  });
});
