import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n";
import { register } from "./auth-api";

const calls = vi.hoisted(() => ({ api: vi.fn(), signIn: vi.fn() }));
vi.mock("../../lib/api", () => ({ api: calls.api, session: { signIn: calls.signIn } }));

afterEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  await i18n.changeLanguage("en");
});

describe("register", () => {
  const values = { name: "R", email: "r@x.com", phone: "01712345678", universityId: "u-1", password: "secret123" };

  it("sends the browser's language and theme, so a Bangla user stays in Bangla", async () => {
    calls.api.mockResolvedValue({ user: { id: "1" }, accessToken: "a", accessTokenExpiresAt: "x" });
    await i18n.changeLanguage("bn");
    localStorage.setItem("unigo.theme", "dark");

    await register(values);

    expect(calls.api).toHaveBeenCalledWith("/auth/register", {
      method: "POST",
      auth: false,
      body: { ...values, language: "BN", theme: "DARK" },
    });
    expect(calls.signIn).toHaveBeenCalled();
  });

  it("sends English and Light by default", async () => {
    calls.api.mockResolvedValue({ user: { id: "1" }, accessToken: "a", accessTokenExpiresAt: "x" });

    await register(values);

    expect(calls.api.mock.calls[0][1].body).toMatchObject({ language: "EN", theme: "LIGHT" });
  });
});
