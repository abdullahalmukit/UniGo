import type { RouteObject } from "react-router";
import { AccountPage } from "../features/account/AccountPage";
import { AddressEditorPage } from "../features/account/AddressEditorPage";
import { BlockedUsersPage } from "../features/account/BlockedUsersPage";
import { MySubAreasPage } from "../features/account/MySubAreasPage";
import { NotificationSettingsPage } from "../features/account/NotificationSettingsPage";
import { SavedAddressesPage } from "../features/account/SavedAddressesPage";
import { AdminAuditLogPage } from "../features/admin/AdminAuditLogPage";
import { AdminDashboardPage } from "../features/admin/AdminDashboardPage";
import { AdminLayout, RequireSuperAdmin } from "../features/admin/AdminLayout";
import { AdminSubAreasPage } from "../features/admin/AdminSubAreasPage";
import { AdminUniversitiesPage } from "../features/admin/AdminUniversitiesPage";
import { AdminUserPage } from "../features/admin/AdminUserPage";
import { AdminUsersPage } from "../features/admin/AdminUsersPage";
import { AdminVerificationsPage } from "../features/admin/AdminVerificationsPage";
import { ActivityPage } from "../features/activity/ActivityPage";
import { AllServicesPage } from "../features/all-services/AllServicesPage";
import { AuthLayout } from "../features/auth/AuthLayout";
import { ForgotPasswordPage } from "../features/auth/ForgotPasswordPage";
import { GoogleRegisterPage } from "../features/auth/GoogleRegisterPage";
import { LoginPage } from "../features/auth/LoginPage";
import { RegisterPage } from "../features/auth/RegisterPage";
import { ResetPasswordPage } from "../features/auth/ResetPasswordPage";
import { HomePage } from "../features/home/HomePage";
import { InboxPage } from "../features/inbox/InboxPage";
import { NotificationsPage } from "../features/notifications/NotificationsPage";
import { ProfilePage } from "../features/profile/ProfilePage";
import { UpcomingPage } from "../features/upcoming/UpcomingPage";
import { VerifyStudentPage } from "../features/verification/VerifyStudentPage";
import { AppLayout } from "./layout/AppLayout";
import { NotFoundPage } from "./NotFoundPage";
import { RequireAuth } from "./RequireAuth";

// Home and All Services are public; the rest need a login (A5a decision).
// Auth pages use their own simple layout without navbar or tabs (A5b decision).
export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "services", element: <AllServicesPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: "activity", element: <ActivityPage /> },
          { path: "upcoming", element: <UpcomingPage /> },
          { path: "inbox", element: <InboxPage /> },
          { path: "notifications", element: <NotificationsPage /> },
          { path: "account", element: <AccountPage /> },
          // Account & Settings sub-pages (A7)
          { path: "account/profile", element: <ProfilePage /> },
          { path: "account/addresses", element: <SavedAddressesPage /> },
          { path: "account/addresses/new", element: <AddressEditorPage /> },
          { path: "account/addresses/:id", element: <AddressEditorPage /> },
          { path: "account/sub-areas", element: <MySubAreasPage /> },
          { path: "account/notifications", element: <NotificationSettingsPage /> },
          { path: "account/blocked", element: <BlockedUsersPage /> },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  // The admin area (A8): its own layout, Moderators and Super Admins only.
  {
    path: "admin",
    element: <AdminLayout />,
    children: [
      { index: true, element: <AdminDashboardPage /> },
      { path: "verifications", element: <AdminVerificationsPage /> },
      { path: "users", element: <AdminUsersPage /> },
      { path: "users/:id", element: <AdminUserPage /> },
      {
        element: <RequireSuperAdmin />,
        children: [
          { path: "universities", element: <AdminUniversitiesPage /> },
          { path: "sub-areas", element: <AdminSubAreasPage /> },
          { path: "audit-log", element: <AdminAuditLogPage /> },
        ],
      },
      { path: "*", element: <AdminDashboardPage /> },
    ],
  },
  {
    element: <AuthLayout />,
    children: [
      { path: "login", element: <LoginPage /> },
      { path: "register", element: <RegisterPage /> },
      { path: "register/google", element: <GoogleRegisterPage /> },
      { path: "forgot-password", element: <ForgotPasswordPage /> },
      { path: "reset-password", element: <ResetPasswordPage /> },
      {
        element: <RequireAuth showLogo={false} />,
        children: [{ path: "verify-student", element: <VerifyStudentPage /> }],
      },
    ],
  },
];
