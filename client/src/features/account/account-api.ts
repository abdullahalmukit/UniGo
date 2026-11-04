import { useSession } from "../../app/use-session";
import { api, apiBaseUrl, session } from "../../lib/api";
import type { StudentVerificationStatus } from "../verification/verification-api";

// The logged-in user's own account and settings (proposal section 5, A7).

export type SignedLink = { url: string; expiresAt: string };

// GET /api/auth/me (also inside every session response)
export type Me = {
  id: string;
  email: string;
  phone: string;
  role: "USER" | "MODERATOR" | "SUPER_ADMIN";
  studentVerificationStatus: StudentVerificationStatus;
  language: "BN" | "EN";
  theme: "LIGHT" | "DARK" | "SYSTEM";
  pushEnabled: boolean;
  emailNotificationsEnabled: boolean;
  isVerifiedRider: boolean;
  riderActive: boolean;
  hasPassword: boolean;
  hasGoogle: boolean;
  university: { id: string; name: string; shortName: string | null };
  profile: {
    fullName: string;
    studentIdNumber: string | null;
    department: string | null;
    batch: string | null;
    location: string | null;
  } | null;
  photo: SignedLink | null;
};

export type AddressLabel = "HOME" | "HALL" | "WORK" | "CUSTOM";
export type SavedAddress = {
  id: string;
  label: AddressLabel;
  customLabel: string | null;
  address: string;
  lat: number;
  lng: number;
};
export type AddressInput = Omit<SavedAddress, "id">;

export type SubArea = { id: string; name: string };
export type BlockedUser = {
  id: string;
  name: string;
  university: { name: string; shortName: string | null };
  photo: SignedLink | null;
  blockedAt: string;
};

// The account the session holds; null for guests.
export function useMe() {
  const state = useSession();
  return state.status === "authenticated" ? (state.session.user as unknown as Me) : null;
}

// Every change answers with the whole account, which every open tab then shows.
async function updateMe(request: Promise<{ user: Me }>) {
  const { user } = await request;
  session.updateUser(user);
  return user;
}

// Signed file links are paths on the API origin.
export const fileUrl = (link: SignedLink | null | undefined) =>
  link ? (/^https?:/.test(link.url) ? link.url : `${apiBaseUrl.replace(/\/api$/, "")}${link.url}`) : null;

export type ProfileInput = {
  name?: string;
  phone?: string;
  studentIdNumber?: string;
  department?: string;
  batch?: string;
  location?: string;
};

export const updateProfile = (body: ProfileInput) =>
  updateMe(api<{ user: Me }>("/me/profile", { method: "PATCH", body }));

export function uploadPhoto(file: Blob) {
  const body = new FormData();
  body.append("photo", file, "photo");
  return updateMe(api<{ user: Me }>("/me/photo", { method: "PUT", body }));
}

export const removePhoto = () => updateMe(api<{ user: Me }>("/me/photo", { method: "DELETE" }));

export type Preferences = Partial<Pick<Me, "language" | "theme" | "emailNotificationsEnabled">>;
export const updatePreferences = (body: Preferences) =>
  updateMe(api<{ user: Me }>("/me/preferences", { method: "PATCH", body }));

// Ends every other session; this device gets a new one.
export async function changePassword(currentPassword: string, newPassword: string) {
  const body = await api<{ user: Me; accessToken: string; accessTokenExpiresAt: string }>("/auth/change-password", {
    method: "POST",
    body: { currentPassword, newPassword },
  });
  session.signIn(body);
}

export const requestPasswordSetupLink = () => api<{ message: string }>("/me/password-setup-link", { method: "POST" });

// `max` is the server's limit (rules.ts), never hard-coded here.
export const listAddresses = () => api<{ addresses: SavedAddress[]; max: number }>("/me/addresses");
export const createAddress = (body: AddressInput) =>
  api<{ address: SavedAddress }>("/me/addresses", { method: "POST", body }).then((r) => r.address);
export const updateAddress = (id: string, body: Partial<AddressInput>) =>
  api<{ address: SavedAddress }>(`/me/addresses/${id}`, { method: "PATCH", body }).then((r) => r.address);
export const deleteAddress = (id: string) => api<null>(`/me/addresses/${id}`, { method: "DELETE" });

export const searchSubAreas = (q: string) =>
  api<{ subAreas: SubArea[] }>(`/sub-areas${q ? `?q=${encodeURIComponent(q)}` : ""}`).then((r) => r.subAreas);
export type MySubAreas = { subAreas: SubArea[]; max: number };
export const getMySubAreas = () => api<MySubAreas>("/me/sub-areas");
export const setMySubAreas = (subAreaIds: string[]) =>
  api<MySubAreas>("/me/sub-areas", { method: "PUT", body: { subAreaIds } });

export const listBlockedUsers = () => api<{ users: BlockedUser[] }>("/me/blocks").then((r) => r.users);
export const unblockUser = (userId: string) => api<null>(`/me/blocks/${userId}`, { method: "DELETE" });
