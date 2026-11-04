import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import { ThemeProvider } from "../../app/theme-provider";
import { ApiError } from "../../lib/api";
import type { SessionState } from "../../lib/session";
import type { StudentVerification } from "./verification-api";

const signedIn: SessionState = {
  status: "authenticated",
  session: { accessToken: "t", expiresAt: Date.now() + 60_000, user: { id: "u1" } },
};

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  session: { getState: () => signedIn, subscribe: () => () => {}, logout: vi.fn(), signIn: vi.fn() },
}));
vi.mock("../../lib/google-identity", () => ({ googleClientId: undefined, loadGoogleIdentity: vi.fn() }));

const verificationApi = vi.hoisted(() => ({
  getStudentVerification: vi.fn(),
  sendEmailCode: vi.fn(),
  confirmEmailCode: vi.fn(),
  uploadIdCard: vi.fn(),
}));
vi.mock("./verification-api", () => verificationApi);

const base: StudentVerification = {
  status: "UNVERIFIED",
  verifiedBy: null,
  universityEmail: null,
  idCard: null,
  emailCode: null,
};

const inAMinute = () => new Date(Date.now() + 60_000).toISOString();
const inTenMinutes = () => new Date(Date.now() + 10 * 60_000).toISOString();

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  return router;
}

beforeEach(() => {
  verificationApi.getStudentVerification.mockResolvedValue(base);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Verify student page", () => {
  it("offers both ways to verify, and a way to do it later", async () => {
    renderAt("/verify-student");

    expect(await screen.findByRole("button", { name: /University email/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Student ID card/ })).toBeEnabled();
    expect(screen.getByText("Not verified")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Do this later" })).toHaveAttribute("href", "/");
  });

  it("verifies with a university email code", async () => {
    verificationApi.sendEmailCode.mockResolvedValue({
      email: "rahim@diu.edu.bd",
      expiresAt: inTenMinutes(),
      resendAvailableAt: inAMinute(),
    });
    verificationApi.confirmEmailCode.mockResolvedValue({
      ...base,
      status: "VERIFIED",
      verifiedBy: "UNIVERSITY_EMAIL",
      universityEmail: "rahim@diu.edu.bd",
    });
    renderAt("/verify-student");

    await userEvent.click(await screen.findByRole("button", { name: /University email/ }));
    await userEvent.type(screen.getByLabelText("University email"), "rahim@diu.edu.bd");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));

    expect(await screen.findByText(/We sent a 6-digit code to rahim@diu.edu.bd/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send a new code in \d+ s/ })).toBeDisabled();

    await userEvent.type(screen.getByLabelText("6-digit code"), "12a3456");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    expect(verificationApi.sendEmailCode).toHaveBeenCalledWith("rahim@diu.edu.bd");
    expect(verificationApi.confirmEmailCode).toHaveBeenCalledWith("123456");
    expect(await screen.findByText(/You are a verified student\. Verified with rahim@diu.edu.bd\./)).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue to Home" })).toBeInTheDocument();
  });

  it("shows why the email was refused, under the field", async () => {
    verificationApi.sendEmailCode.mockRejectedValue(new ApiError(400, { code: "EMAIL_DOMAIN_NOT_ALLOWED" }));
    renderAt("/verify-student");

    await userEvent.click(await screen.findByRole("button", { name: /University email/ }));
    await userEvent.type(screen.getByLabelText("University email"), "rahim@gmail.com");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));

    expect(await screen.findByText(/Use the email address your university gave you\. Ask/)).toBeInTheDocument();
  });

  it("says how many tries are left after a wrong code", async () => {
    verificationApi.getStudentVerification.mockResolvedValue({
      ...base,
      emailCode: { email: "rahim@diu.edu.bd", expiresAt: inTenMinutes(), resendAvailableAt: inAMinute(), attemptsLeft: 5 },
    });
    verificationApi.confirmEmailCode.mockRejectedValue(new ApiError(400, { code: "OTP_INVALID", attemptsLeft: 4 }));
    renderAt("/verify-student");

    // A code already waiting opens the code step straight away.
    await userEvent.type(await screen.findByLabelText("6-digit code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByText("This code is not right. 4 tries left.")).toBeInTheDocument();
  });

  it("uploads the ID card and shows that it is under review", async () => {
    verificationApi.uploadIdCard.mockResolvedValue({
      ...base,
      status: "PENDING",
      idCard: { status: "PENDING", submittedAt: "2026-11-04T06:00:00.000Z", reviewedAt: null, rejectionReason: null },
    });
    renderAt("/verify-student");

    await userEvent.click(await screen.findByRole("button", { name: /Student ID card/ }));
    const file = new File(["%PDF-1.4"], "card.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText("Choose a file"), file);
    expect(screen.getByText("PDF selected: card.pdf")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send for review" }));

    expect(verificationApi.uploadIdCard).toHaveBeenCalledWith(file);
    expect(await screen.findByText(/Your ID card was sent on 4 November 2026/)).toBeInTheDocument();
    expect(screen.getAllByText("Under review").length).toBeGreaterThan(0);
    // While the card is reviewed, the email way is still open.
    expect(screen.getByRole("button", { name: /University email/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Student ID card/ })).toBeDisabled();
  });

  it("refuses a file type the server would refuse, without uploading", async () => {
    renderAt("/verify-student");

    await userEvent.click(await screen.findByRole("button", { name: /Student ID card/ }));
    const input = screen.getByLabelText("Choose a file");
    await userEvent.upload(input, new File(["x"], "card.gif", { type: "image/gif" }), { applyAccept: false });

    expect(screen.getByText("Upload a JPG, PNG or PDF file.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send for review" }));
    expect(screen.getByText("Choose a file to upload.")).toBeInTheDocument();
    expect(verificationApi.uploadIdCard).not.toHaveBeenCalled();
  });

  it("shows the rejection reason and lets the student try again", async () => {
    verificationApi.getStudentVerification.mockResolvedValue({
      ...base,
      status: "REJECTED",
      idCard: {
        status: "REJECTED",
        submittedAt: "2026-11-03T06:00:00.000Z",
        reviewedAt: "2026-11-03T08:00:00.000Z",
        rejectionReason: "The photo is too blurry",
      },
    });
    renderAt("/verify-student");

    expect(await screen.findByText(/Reason: The photo is too blurry/)).toBeInTheDocument();
    expect(screen.getByText("Rejected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Student ID card/ })).toBeEnabled();
  });

  it("offers to try again when the status cannot be loaded", async () => {
    verificationApi.getStudentVerification.mockRejectedValueOnce(new Error("offline"));
    renderAt("/verify-student");

    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /University email/ })).toBeInTheDocument();
  });
});

describe("Account page", () => {
  it("shows the verification status at the top and in the menu", async () => {
    verificationApi.getStudentVerification.mockResolvedValue({ ...base, status: "PENDING" });
    renderAt("/account");

    await waitFor(() => expect(screen.getAllByText("Under review")).toHaveLength(2));
    const links = screen.getAllByRole("link", { name: /Student verification|Verification/ });
    for (const link of links) expect(link).toHaveAttribute("href", "/verify-student?next=%2Faccount");
  });
});
