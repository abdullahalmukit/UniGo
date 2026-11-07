import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import { ThemeProvider } from "../../app/theme-provider";
import { ToastProvider } from "../../components/toast";
import { ApiError } from "../../lib/api";
import type { SessionState } from "../../lib/session";
import type { Me } from "./account-api";

const state = vi.hoisted(() => ({ current: { status: "guest" } as SessionState }));
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  session: { getState: () => state.current, subscribe: () => () => {}, logout: vi.fn(), signIn: vi.fn(), updateUser: vi.fn() },
}));
vi.mock("../../lib/google-identity", () => ({ googleClientId: undefined, loadGoogleIdentity: vi.fn() }));
const push = vi.hoisted(() => ({ pushState: vi.fn(), enablePush: vi.fn(), disablePush: vi.fn() }));
vi.mock("../../lib/push", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/push")>()), ...push }));
vi.mock("../verification/verification-api", () => ({
  getStudentVerification: vi.fn().mockResolvedValue({ status: "VERIFIED" }),
}));
// Leaflet needs a real browser; the editor's map is tested by hand.
vi.mock("../../components/MapPicker", () => ({
  MapPicker: ({ onMove }: { onMove: (point: { lat: number; lng: number }) => void }) => (
    <button type="button" onClick={() => onMove({ lat: 23.75, lng: 90.38 })}>
      move map
    </button>
  ),
}));
vi.mock("../../lib/nominatim", () => ({
  geocoder: {
    search: vi.fn().mockResolvedValue([{ label: "Dhanmondi Lake, Dhaka", lat: 23.745, lng: 90.375 }]),
    reverse: vi.fn().mockResolvedValue("Road 27, Dhanmondi, Dhaka"),
  },
}));

const accountApi = vi.hoisted(() => ({
  updateProfile: vi.fn(),
  uploadPhoto: vi.fn(),
  removePhoto: vi.fn(),
  updatePreferences: vi.fn(),
  changePassword: vi.fn(),
  requestPasswordSetupLink: vi.fn(),
  listAddresses: vi.fn(),
  createAddress: vi.fn(),
  updateAddress: vi.fn(),
  deleteAddress: vi.fn(),
  searchSubAreas: vi.fn(),
  getMySubAreas: vi.fn(),
  setMySubAreas: vi.fn(),
  listBlockedUsers: vi.fn(),
  unblockUser: vi.fn(),
}));
vi.mock("./account-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./account-api")>()),
  ...accountApi,
}));

const me: Me = {
  id: "me",
  email: "rina@example.com",
  phone: "+8801712345678",
  role: "USER",
  studentVerificationStatus: "VERIFIED",
  language: "EN",
  theme: "LIGHT",
  pushEnabled: false,
  emailNotificationsEnabled: true,
  isVerifiedRider: false,
  riderActive: false,
  hasPassword: true,
  hasGoogle: false,
  university: { id: "uni", name: "Alpha University", shortName: "AU" },
  profile: { fullName: "Rina Akter", studentIdNumber: null, department: "CSE", batch: null, location: null },
  photo: null,
};

const signedIn = (user: Partial<Me> = {}): SessionState => ({
  status: "authenticated",
  session: { accessToken: "t", expiresAt: Date.now() + 60_000, user: { ...me, ...user } },
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <ThemeProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </ThemeProvider>,
  );
  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.current = signedIn();
});

describe("Account & Settings", () => {
  it("links every built menu and marks later ones as coming soon", async () => {
    renderAt("/account");

    expect(await screen.findByRole("link", { name: /Rina Akter/ })).toHaveAttribute("href", "/account/profile");
    // The navbar has its own Notifications link, so look inside the menu.
    const menu = within(screen.getByText("Saved Addresses").closest("ul")!);
    for (const [name, href] of [
      ["Profile", "/account/profile"],
      ["Saved Addresses", "/account/addresses"],
      ["My Sub-Areas", "/account/sub-areas"],
      ["Notifications", "/account/notifications"],
      ["Blocked Users", "/account/blocked"],
      ["Drive with UniGo", "/drive"],
    ]) {
      expect(menu.getByRole("link", { name })).toHaveAttribute("href", href);
    }
    for (const name of ["Payment Methods", "Promos", "Support Request", "Policy", "Rate Us"]) {
      const item = screen.getByText(name).closest("li")!;
      expect(within(item).getByText("Coming soon")).toBeInTheDocument();
      expect(within(item).queryByRole("link")).toBeNull();
    }
  });

  it("saves language and appearance to the account", async () => {
    accountApi.updatePreferences.mockResolvedValue(me);
    renderAt("/account");

    await userEvent.click(await screen.findByRole("radio", { name: "Dark" }));
    expect(accountApi.updatePreferences).toHaveBeenCalledWith({ theme: "DARK" });
    expect(document.documentElement.dataset.theme).toBe("dark");

    await userEvent.click(screen.getByRole("radio", { name: "বাংলা" }));
    expect(accountApi.updatePreferences).toHaveBeenCalledWith({ language: "BN" });
    await userEvent.click(await screen.findByRole("radio", { name: "English" }));
  });
});

describe("Profile", () => {
  it("sends only the changed fields and shows the server's field error", async () => {
    accountApi.updateProfile.mockRejectedValueOnce(new ApiError(409, { code: "PHONE_TAKEN" }));
    renderAt("/account/profile");

    expect(await screen.findByText("rina@example.com")).toBeInTheDocument();
    expect(screen.getByText("Email and university cannot be changed after registration.")).toBeInTheDocument();
    const phone = screen.getByLabelText("Mobile number");
    expect(phone).toHaveValue("01712345678");

    await userEvent.clear(phone);
    await userEvent.type(phone, "01812345678");
    await userEvent.type(screen.getByLabelText("Batch"), "2022");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(accountApi.updateProfile).toHaveBeenCalledWith({ phone: "01812345678", batch: "2022" });
    expect(await screen.findByText("This mobile number is already registered.")).toBeInTheDocument();
  });

  it("changes the password after checking the confirmation", async () => {
    accountApi.changePassword.mockResolvedValue(undefined);
    renderAt("/account/profile");

    await userEvent.click(await screen.findByRole("button", { name: "Change password" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Current password"), "secret123");
    await userEvent.type(within(dialog).getByLabelText("New password"), "brandnew99");
    await userEvent.type(within(dialog).getByLabelText("Confirm new password"), "brandnew98");
    await userEvent.click(within(dialog).getByRole("button", { name: "Change password" }));
    expect(screen.getByText("The passwords do not match.")).toBeInTheDocument();
    expect(accountApi.changePassword).not.toHaveBeenCalled();

    const confirm = within(dialog).getByLabelText("Confirm new password");
    await userEvent.clear(confirm);
    await userEvent.type(confirm, "brandnew99");
    await userEvent.click(within(dialog).getByRole("button", { name: "Change password" }));
    expect(accountApi.changePassword).toHaveBeenCalledWith("secret123", "brandnew99");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("offers a Google-only account the emailed link instead", async () => {
    state.current = signedIn({ hasPassword: false, hasGoogle: true });
    accountApi.requestPasswordSetupLink.mockResolvedValue({ message: "sent" });
    renderAt("/account/profile");

    expect(screen.queryByRole("button", { name: "Change password" })).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: "Email me a link" }));
    expect(accountApi.requestPasswordSetupLink).toHaveBeenCalled();
    expect(await screen.findByText("Check your email for the link to set a password.")).toBeInTheDocument();
  });
});

describe("Saved Addresses", () => {
  const home = { id: "a1", label: "HOME" as const, customLabel: null, address: "Road 27, Dhanmondi", lat: 23.74, lng: 90.37 };

  it("lists Home, offers Hall and Work, and deletes after confirming", async () => {
    accountApi.listAddresses.mockResolvedValue({ addresses: [home], max: 10 });
    accountApi.deleteAddress.mockResolvedValue(null);
    renderAt("/account/addresses");

    expect(await screen.findByText("Road 27, Dhanmondi")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Add your hall/ })).toHaveAttribute("href", "/account/addresses/new?label=HALL");
    expect(screen.getByText("1 of 10 saved")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete Home" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(accountApi.deleteAddress).toHaveBeenCalledWith("a1");
    await waitFor(() => expect(screen.queryByText("Road 27, Dhanmondi")).toBeNull());
  });

  it("adds a custom place from a search result", async () => {
    accountApi.listAddresses.mockResolvedValue({ addresses: [home], max: 10 });
    accountApi.createAddress.mockResolvedValue({ ...home, id: "a2", label: "CUSTOM", customLabel: "Lake" });
    const router = renderAt("/account/addresses/new?label=CUSTOM");

    // Home is taken, so it cannot be picked again.
    expect(await screen.findByRole("radio", { name: "Home" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Name of the place"), "Lake");
    await userEvent.type(screen.getByLabelText("Search for a place"), "Dhanmondi lake");
    await userEvent.click(await screen.findByRole("button", { name: "Dhanmondi Lake, Dhaka" }, { timeout: 3000 }));
    expect(screen.getByLabelText("Address")).toHaveValue("Dhanmondi Lake, Dhaka");

    await userEvent.click(screen.getByRole("button", { name: "Save address" }));
    expect(accountApi.createAddress).toHaveBeenCalledWith({
      label: "CUSTOM",
      customLabel: "Lake",
      address: "Dhanmondi Lake, Dhaka",
      lat: 23.745,
      lng: 90.375,
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/account/addresses"));
  });

  it("sends 'Add Home' to the saved Home when there is one", async () => {
    accountApi.listAddresses.mockResolvedValue({ addresses: [home], max: 10 });
    const router = renderAt("/account/addresses/new?label=HOME");
    await waitFor(() => expect(router.state.location.pathname).toBe("/account/addresses/a1"));
    expect(await screen.findByLabelText("Address")).toHaveValue("Road 27, Dhanmondi");
  });
});

describe("My Sub-Areas", () => {
  it("adds and removes sub-areas from the master list", async () => {
    const banani = { id: "s1", name: "Banani" };
    const gulshan = { id: "s2", name: "Gulshan" };
    accountApi.getMySubAreas.mockResolvedValue({ subAreas: [banani], max: 20 });
    accountApi.searchSubAreas.mockResolvedValue([banani, gulshan]);
    accountApi.setMySubAreas.mockResolvedValueOnce({ subAreas: [banani, gulshan], max: 20 });
    accountApi.setMySubAreas.mockResolvedValueOnce({ subAreas: [gulshan], max: 20 });
    renderAt("/account/sub-areas");

    expect(await screen.findByText("Selected (1 of 20)")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Banani is already added" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Add Gulshan" }));
    expect(accountApi.setMySubAreas).toHaveBeenCalledWith(["s1", "s2"]);
    expect(await screen.findByText("Selected (2 of 20)")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Remove Banani" }));
    expect(accountApi.setMySubAreas).toHaveBeenLastCalledWith(["s2"]);
  });
});

describe("Notification settings", () => {
  it("turns Web Push on for this device and saves the email setting", async () => {
    push.pushState.mockResolvedValue("off");
    push.enablePush.mockResolvedValue("on");
    accountApi.updatePreferences.mockResolvedValue(me);
    renderAt("/account/notifications");

    const pushSwitch = await screen.findByRole("switch", { name: "Push notifications" });
    await waitFor(() => expect(pushSwitch).toBeEnabled());
    expect(pushSwitch).toHaveAttribute("aria-checked", "false");
    await userEvent.click(pushSwitch);
    expect(push.enablePush).toHaveBeenCalled();
    await waitFor(() => expect(pushSwitch).toHaveAttribute("aria-checked", "true"));
    expect(await screen.findByText("Push notifications turned on for this device.")).toBeInTheDocument();

    const email = screen.getByRole("switch", { name: "Activity emails" });
    expect(email).toHaveAttribute("aria-checked", "true");
    await userEvent.click(email);
    expect(accountApi.updatePreferences).toHaveBeenCalledWith({ emailNotificationsEnabled: false });
  });
});

describe("Notification settings: push states", () => {
  it("turns push off on this device", async () => {
    push.pushState.mockResolvedValue("on");
    push.disablePush.mockResolvedValue("off");
    renderAt("/account/notifications");
    const pushSwitch = await screen.findByRole("switch", { name: "Push notifications" });
    await waitFor(() => expect(pushSwitch).toHaveAttribute("aria-checked", "true"));
    await userEvent.click(pushSwitch);
    expect(push.disablePush).toHaveBeenCalled();
    await waitFor(() => expect(pushSwitch).toHaveAttribute("aria-checked", "false"));
  });

  it("explains when the browser blocks notifications or cannot show them", async () => {
    push.pushState.mockResolvedValue("denied");
    renderAt("/account/notifications");
    expect(await screen.findByText(/Notifications are blocked for UniGo in this browser/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Push notifications" })).toBeDisabled();
    cleanup();

    push.pushState.mockResolvedValue("unsupported");
    renderAt("/account/notifications");
    expect(await screen.findByText(/This browser cannot show push notifications/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Push notifications" })).toBeDisabled();
  });
});

describe("Blocked Users", () => {
  it("shows an empty state", async () => {
    accountApi.listBlockedUsers.mockResolvedValue([]);
    renderAt("/account/blocked");
    expect(await screen.findByText(/You have not blocked anyone/)).toBeInTheDocument();
  });

  it("unblocks after confirming", async () => {
    accountApi.listBlockedUsers.mockResolvedValue([
      { id: "u2", name: "Karim", university: { name: "Beta University", shortName: null }, photo: null, blockedAt: "" },
    ]);
    accountApi.unblockUser.mockResolvedValue(null);
    renderAt("/account/blocked");

    await userEvent.click(await screen.findByRole("button", { name: "Unblock" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Unblock" }));
    expect(accountApi.unblockUser).toHaveBeenCalledWith("u2");
    expect(await screen.findByText(/You have not blocked anyone/)).toBeInTheDocument();
  });
});
