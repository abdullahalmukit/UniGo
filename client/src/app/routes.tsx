import type { RouteObject } from "react-router";
import { AccountPage } from "../features/account/AccountPage";
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
        ],
      },
      { path: "*", element: <NotFoundPage /> },
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
