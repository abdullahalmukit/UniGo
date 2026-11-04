import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import { ThemeProvider } from "../../app/theme-provider";
import { ApiError } from "../../lib/api";

const authApi = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  googleSignIn: vi.fn(),
  googleRegister: vi.fn(),
  googleLink: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
  listUniversities: vi.fn(),
}));
vi.mock("./auth-api", () => authApi);

// Google's library, faked: its button hands back "google-id-token" when clicked.
vi.mock("../../lib/google-identity", () => ({
  googleClientId: "test-client.apps.googleusercontent.com",
  loadGoogleIdentity: () =>
    Promise.resolve({
      accounts: {
        id: {
          initialize: (options: { callback: (r: { credential: string }) => void }) => {
            (globalThis as { googleCallback?: typeof options.callback }).googleCallback = options.callback;
          },
          renderButton: (element: HTMLElement) => {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = "Continue with Google";
            button.onclick = () =>
              (globalThis as { googleCallback?: (r: { credential: string }) => void }).googleCallback?.({
                credential: "google-id-token",
              });
            element.append(button);
          },
        },
      },
    }),
}));

const universities = [
  { id: "u-1", name: "Alpha University", shortName: "AU" },
  { id: "u-2", name: "Beta University", shortName: "BU" },
];

function renderAt(path: string, state?: unknown) {
  const router = createMemoryRouter(routes, { initialEntries: [state ? { pathname: path, state } : path] });
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  return router;
}

beforeEach(() => {
  authApi.listUniversities.mockResolvedValue(universities);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Login", () => {
  it("shows the full logo, the language switch and Back to Home, without the navbar", async () => {
    renderAt("/login");

    expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
    expect(screen.getAllByAltText("UniGo: Ride, Food, Service")).not.toHaveLength(0);
    expect(screen.getByRole("link", { name: "Back to Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("button", { name: "বাংলা" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Bottom tabs" })).toBeNull();
  });

  it("labels the link exactly as the emails do", async () => {
    renderAt("/login");
    expect(await screen.findByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/forgot-password");
  });

  it("checks required fields in the browser", async () => {
    renderAt("/login");
    await userEvent.click(await screen.findByRole("button", { name: "Log in" }));

    expect(screen.getAllByText("Fill in this field.")).toHaveLength(2);
    expect(authApi.login).not.toHaveBeenCalled();
  });

  it("shows a friendly message for INVALID_CREDENTIALS", async () => {
    authApi.login.mockRejectedValue(new ApiError(401, { code: "INVALID_CREDENTIALS", message: "x" }));
    renderAt("/login");

    await userEvent.type(await screen.findByLabelText("Email"), "a@b.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong1234");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
  });

  it("goes to next after logging in", async () => {
    authApi.login.mockResolvedValue({});
    const router = renderAt("/login?next=%2Fupcoming");

    await userEvent.type(await screen.findByLabelText("Email"), "a@b.com");
    await userEvent.type(screen.getByLabelText("Password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/upcoming"));
    expect(authApi.login).toHaveBeenCalledWith("a@b.com", "secret123");
  });

  it("goes Home when next points to another site", async () => {
    authApi.login.mockResolvedValue({});
    const router = renderAt(`/login?next=${encodeURIComponent("https://evil.example")}`);

    await userEvent.type(await screen.findByLabelText("Email"), "a@b.com");
    await userEvent.type(screen.getByLabelText("Password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("shows a success message after a password reset", async () => {
    renderAt("/login?reset=done");
    expect(await screen.findByRole("status")).toHaveTextContent("Your password was changed.");
  });
});

describe("Google sign-in", () => {
  it("asks a new Google user for phone, university and name", async () => {
    authApi.googleSignIn.mockResolvedValue({
      needsRegistration: true,
      signupToken: "signup-1",
      email: "new@gmail.com",
      name: "New Person",
    });
    authApi.googleRegister.mockResolvedValue({});
    const router = renderAt("/login");

    await userEvent.click(await screen.findByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Finish signing up" })).toBeInTheDocument();
    expect(screen.getByText("new@gmail.com")).toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toHaveValue("New Person");

    await userEvent.type(screen.getByLabelText("Mobile number"), "01712345678");
    await userEvent.click(screen.getByRole("button", { name: "University" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("radio", { name: /Beta University/ }));
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/verify-student"));
    expect(authApi.googleRegister).toHaveBeenCalledWith({
      signupToken: "signup-1",
      name: "New Person",
      phone: "01712345678",
      universityId: "u-2",
    });
  });

  it("asks once for the password before linking Google to an existing account", async () => {
    authApi.googleSignIn.mockRejectedValue(
      new ApiError(409, { code: "GOOGLE_LINK_REQUIRES_PASSWORD", message: "x", linkToken: "link-1", email: "me@uni.edu" }),
    );
    authApi.googleLink.mockResolvedValue({});
    const router = renderAt("/login?next=%2Finbox");

    await userEvent.click(await screen.findByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Link Google sign-in" })).toBeInTheDocument();
    expect(screen.getByText(/me@uni\.edu/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Link and log in" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/inbox"));
    expect(authApi.googleLink).toHaveBeenCalledWith("link-1", "secret123");
  });

  it("sends someone who opens the Google signup page directly back to Login", async () => {
    const router = renderAt("/register/google");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  });
});

describe("Register", () => {
  async function fillAndSubmit() {
    await userEvent.type(await screen.findByLabelText("Full name"), "Rahim Uddin");
    await userEvent.type(screen.getByLabelText("Email"), "rahim@example.com");
    await userEvent.type(screen.getByLabelText("Mobile number"), "01712345678");
    await userEvent.click(screen.getByRole("button", { name: "University" }));
    const sheet = await screen.findByRole("dialog");
    await userEvent.type(within(sheet).getByLabelText("Search universities"), "alp");
    expect(within(sheet).queryByRole("radio", { name: /Beta/ })).toBeNull();
    await userEvent.click(within(sheet).getByRole("radio", { name: /Alpha University/ }));
    await userEvent.type(screen.getByLabelText("Password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
  }

  it("shows the password rule as a hint", async () => {
    renderAt("/register");
    expect(await screen.findByText("8–72 characters, with at least one letter and one number.")).toBeInTheDocument();
  });

  it("registers and shows the verify-your-student-status screen", async () => {
    authApi.register.mockResolvedValue({});
    const router = renderAt("/register");

    await fillAndSubmit();

    await waitFor(() => expect(router.state.location.pathname).toBe("/verify-student"));
    expect(authApi.register).toHaveBeenCalledWith({
      name: "Rahim Uddin",
      email: "rahim@example.com",
      phone: "01712345678",
      universityId: "u-1",
      password: "secret123",
    });
  });

  it("shows server field errors under each field, translated", async () => {
    authApi.register.mockRejectedValue(
      new ApiError(400, { code: "VALIDATION_ERROR", message: "x", fields: { phone: ["bad"], password: ["bad"] } }),
    );
    renderAt("/register");

    await fillAndSubmit();

    expect(await screen.findByText("Enter a Bangladesh mobile number, for example 01712345678.")).toBeInTheDocument();
    expect(screen.getByLabelText("Mobile number")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Use 8–72 characters, with at least one letter and one number.")).toBeInTheDocument();
  });

  it("shows PHONE_TAKEN under the phone field", async () => {
    authApi.register.mockRejectedValue(new ApiError(409, { code: "PHONE_TAKEN", message: "x" }));
    renderAt("/register");

    await fillAndSubmit();

    expect(await screen.findByText("This mobile number is already registered.")).toBeInTheDocument();
  });
});

describe("Forgot password", () => {
  it("shows the same confirmation whatever the email", async () => {
    authApi.forgotPassword.mockResolvedValue({ message: "x" });
    renderAt("/forgot-password");

    await userEvent.type(await screen.findByLabelText("Email"), "anyone@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("status")).toHaveTextContent("If this email is registered, a reset link has been sent.");
  });

  it("shows the rate-limit message", async () => {
    authApi.forgotPassword.mockRejectedValue(new ApiError(429, { code: "RATE_LIMITED", message: "x" }));
    renderAt("/forgot-password");

    await userEvent.type(await screen.findByLabelText("Email"), "anyone@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts.");
  });
});

describe("Reset password", () => {
  it("reads the token from the fragment, removes it from the address and goes to Login", async () => {
    authApi.resetPassword.mockResolvedValue(null);
    const router = renderAt("/reset-password#token=abc123");

    await waitFor(() => expect(router.state.location.hash).toBe(""));
    await userEvent.type(screen.getByLabelText("New password"), "brandnew42");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "brandnew42");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toBe("?reset=done");
    expect(authApi.resetPassword).toHaveBeenCalledWith("abc123", "brandnew42");
  });

  it("checks that both passwords match", async () => {
    renderAt("/reset-password#token=abc123");

    await userEvent.type(await screen.findByLabelText("New password"), "brandnew42");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "brandnew43");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(screen.getByText("The passwords do not match.")).toBeInTheDocument();
    expect(authApi.resetPassword).not.toHaveBeenCalled();
  });

  it("explains an expired link and offers a new one", async () => {
    authApi.resetPassword.mockRejectedValue(new ApiError(400, { code: "INVALID_RESET_TOKEN", message: "x" }));
    renderAt("/reset-password#token=old");

    await userEvent.type(await screen.findByLabelText("New password"), "brandnew42");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "brandnew42");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This reset link is invalid or has expired.");
    expect(screen.getByRole("link", { name: "Ask for a new link" })).toHaveAttribute("href", "/forgot-password");
  });

  it("says when the link has no token", async () => {
    renderAt("/reset-password");
    expect(await screen.findByRole("alert")).toHaveTextContent("This reset link is incomplete.");
  });
});
