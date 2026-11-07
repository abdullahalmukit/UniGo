import type { ComponentType } from "react";
import type { RouteObject } from "react-router";
import { AccountPage } from "../features/account/AccountPage";
import { AddressEditorPage } from "../features/account/AddressEditorPage";
import { BlockedUsersPage } from "../features/account/BlockedUsersPage";
import { MySubAreasPage } from "../features/account/MySubAreasPage";
import { NotificationSettingsPage } from "../features/account/NotificationSettingsPage";
import { SavedAddressesPage } from "../features/account/SavedAddressesPage";
import { ActivityPage } from "../features/activity/ActivityPage";
import { AllServicesPage } from "../features/all-services/AllServicesPage";
import { AuthLayout } from "../features/auth/AuthLayout";
import { ForgotPasswordPage } from "../features/auth/ForgotPasswordPage";
import { GoogleRegisterPage } from "../features/auth/GoogleRegisterPage";
import { LoginPage } from "../features/auth/LoginPage";
import { RegisterPage } from "../features/auth/RegisterPage";
import { ResetPasswordPage } from "../features/auth/ResetPasswordPage";
import { HomePage } from "../features/home/HomePage";
import { ChatPage } from "../features/inbox/ChatPage";
import { InboxPage } from "../features/inbox/InboxPage";
import { NotificationsPage } from "../features/notifications/NotificationsPage";
import { ProfilePage } from "../features/profile/ProfilePage";
import { UpcomingPage } from "../features/upcoming/UpcomingPage";
import { VerifyStudentPage } from "../features/verification/VerifyStudentPage";
import { AppLayout } from "./layout/AppLayout";
import { NotFoundPage } from "./NotFoundPage";
import { RequireAuth } from "./RequireAuth";

// Loads a page only when its route is opened (B1): the admin area and Drive
// with UniGo stay out of the first download, which every visitor makes.
function page<T>(load: () => Promise<T>, pick: (module: T) => ComponentType) {
  return async () => ({ Component: pick(await load()) });
}

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
          { path: "inbox/:chatId", element: <ChatPage /> },
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
          // Drive with UniGo (B1)
          { path: "drive", lazy: page(() => import("../features/rider/DrivePage"), (m) => m.DrivePage) },
          // Public profiles (B3b-1 G); the server allows verified students only
          { path: "u/:id", lazy: page(() => import("../features/profile/PublicProfilePage"), (m) => m.PublicProfilePage) },
          // Ride Sharing (B3a): verified students only, loaded per route (map and forms)
          {
            path: "ride",
            lazy: page(() => import("../features/ride/RideGate"), (m) => m.RideGate),
            children: [
              { index: true, lazy: page(() => import("../features/ride/RidePage"), (m) => m.RidePage) },
              { path: "requests/new", lazy: page(() => import("../features/ride/RideForms"), (m) => m.RequestFormPage) },
              { path: "requests/:id", lazy: page(() => import("../features/ride/RideDetails"), (m) => m.RequestDetailPage) },
              { path: "requests/:id/edit", lazy: page(() => import("../features/ride/RideForms"), (m) => m.RequestFormPage) },
              { path: "offers/new", lazy: page(() => import("../features/ride/RideForms"), (m) => m.OfferFormPage) },
              { path: "offers/:id", lazy: page(() => import("../features/ride/RideDetails"), (m) => m.OfferDetailPage) },
              { path: "offers/:id/edit", lazy: page(() => import("../features/ride/RideForms"), (m) => m.OfferFormPage) },
              { path: "bookings/:id", lazy: page(() => import("../features/ride/RideDetails"), (m) => m.BookingDetailPage) },
            ],
          },
          // Food Delivery (B4): verified students only, loaded per route
          {
            path: "food",
            lazy: page(() => import("../features/food/FoodCard"), (m) => m.FoodGate),
            children: [
              { index: true, lazy: page(() => import("../features/food/FoodPage"), (m) => m.FoodPage) },
              { path: "requests/new", lazy: page(() => import("../features/food/FoodForm"), (m) => m.FoodFormPage) },
              { path: "requests/:id", lazy: page(() => import("../features/food/FoodDetails"), (m) => m.FoodDetailPage) },
              { path: "requests/:id/edit", lazy: page(() => import("../features/food/FoodForm"), (m) => m.FoodFormPage) },
            ],
          },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  // The admin area (A8): its own layout, Moderators and Super Admins only.
  {
    path: "admin",
    lazy: page(() => import("../features/admin/AdminLayout"), (m) => m.AdminLayout),
    children: [
      { index: true, lazy: page(() => import("../features/admin/AdminDashboardPage"), (m) => m.AdminDashboardPage) },
      { path: "verifications", lazy: page(() => import("../features/admin/AdminVerificationsPage"), (m) => m.AdminVerificationsPage) },
      { path: "rider-requests", lazy: page(() => import("../features/admin/AdminRiderRequestsPage"), (m) => m.AdminRiderRequestsPage) },
      { path: "rider-requests/:id", lazy: page(() => import("../features/admin/AdminRiderApplicationPage"), (m) => m.AdminRiderApplicationPage) },
      { path: "users", lazy: page(() => import("../features/admin/AdminUsersPage"), (m) => m.AdminUsersPage) },
      { path: "users/:id", lazy: page(() => import("../features/admin/AdminUserPage"), (m) => m.AdminUserPage) },
      // Ride Sharing (B3b-2): Moderators and Super Admins
      { path: "rides", lazy: page(() => import("../features/admin/AdminRidesPage"), (m) => m.AdminRidesPage) },
      { path: "rides/activities/:id", lazy: page(() => import("../features/admin/AdminRideDetailPage"), (m) => m.AdminRideActivityPage) },
      { path: "rides/offers/:id", lazy: page(() => import("../features/admin/AdminRideDetailPage"), (m) => m.AdminRideOfferPage) },
      // Food (B4): Moderators and Super Admins
      { path: "food", lazy: page(() => import("../features/admin/AdminFoodPage"), (m) => m.AdminFoodPage) },
      { path: "food/:id", lazy: page(() => import("../features/admin/AdminFoodPage"), (m) => m.AdminFoodDetailPage) },
      {
        lazy: page(() => import("../features/admin/AdminLayout"), (m) => m.RequireSuperAdmin),
        children: [
          { path: "universities", lazy: page(() => import("../features/admin/AdminUniversitiesPage"), (m) => m.AdminUniversitiesPage) },
          { path: "sub-areas", lazy: page(() => import("../features/admin/AdminSubAreasPage"), (m) => m.AdminSubAreasPage) },
          { path: "audit-log", lazy: page(() => import("../features/admin/AdminAuditLogPage"), (m) => m.AdminAuditLogPage) },
          { path: "fare-settings", lazy: page(() => import("../features/admin/AdminFareSettingsPage"), (m) => m.AdminFareSettingsPage) },
        ],
      },
      { path: "*", lazy: page(() => import("../features/admin/AdminDashboardPage"), (m) => m.AdminDashboardPage) },
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
