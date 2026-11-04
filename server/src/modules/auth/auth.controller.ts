import type { CookieOptions, Request, Response } from "express";
import { env } from "../../config/env.js";
import { authUser } from "../../middleware/authenticate.js";
import { AppError } from "../../utils/app-error.js";
import { runInBackground } from "../../utils/background.js";
import * as authService from "./auth.service.js";
import * as googleService from "./google.service.js";
import * as passwordReset from "./password-reset.service.js";

export const REFRESH_COOKIE = "unigo_refresh";

// httpOnly, only sent to /api/auth, Secure only in production so it works on
// http://localhost in development (A3 decision).
const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: env.NODE_ENV === "production",
  path: "/api/auth",
};

type Session = Awaited<ReturnType<typeof authService.login>>;

export async function register(req: Request, res: Response) {
  sendSession(res.status(201), await authService.register(req.body, sessionMeta(req)));
}

export async function login(req: Request, res: Response) {
  sendSession(res, await authService.login(req.body, sessionMeta(req)));
}

export async function refresh(req: Request, res: Response) {
  const token: string | undefined = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw new AppError(401, "INVALID_REFRESH_TOKEN", "Log in again");

  try {
    sendSession(res, await authService.refresh(token, sessionMeta(req)));
  } catch (error) {
    if (error instanceof AppError && error.code === "INVALID_REFRESH_TOKEN") {
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
    }
    throw error;
  }
}

export async function logout(req: Request, res: Response) {
  await authService.logout(req.cookies?.[REFRESH_COOKIE]);
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions).status(204).end();
}

export async function logoutAll(req: Request, res: Response) {
  await authService.logoutAll(authUser(req).id);
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions).status(204).end();
}

export async function me(req: Request, res: Response) {
  res.json({ user: await authService.getMe(authUser(req).id) });
}

// Always the same answer, sent before any lookup happens.
export function forgotPassword(req: Request, res: Response) {
  const { email } = req.body as { email: string };
  runInBackground("password reset request", () => passwordReset.requestPasswordReset(email));
  res.status(202).json({ message: "If this email is registered, a reset link has been sent" });
}

export async function resetPassword(req: Request, res: Response) {
  await passwordReset.resetPassword(req.body.token, req.body.password);
  res.status(204).end();
}

export async function googleSignIn(req: Request, res: Response) {
  const result = await googleService.signInWithGoogle(req.body.idToken, sessionMeta(req));
  if (result.kind === "session") {
    sendSession(res, result.session);
    return;
  }
  res.json({ needsRegistration: true, signupToken: result.signupToken, email: result.email, name: result.name });
}

export async function googleRegister(req: Request, res: Response) {
  sendSession(res.status(201), await googleService.registerWithGoogle(req.body, sessionMeta(req)));
}

export async function googleLink(req: Request, res: Response) {
  sendSession(res, await googleService.linkGoogle(req.body, sessionMeta(req)));
}

// The refresh token goes only into the cookie, never into the JSON body.
function sendSession(res: Response, session: Session) {
  res
    .cookie(REFRESH_COOKIE, session.refreshToken, { ...refreshCookieOptions, expires: session.refreshTokenExpiresAt })
    .json({
      user: session.user,
      accessToken: session.accessToken,
      accessTokenExpiresAt: session.accessTokenExpiresAt,
    });
}

function sessionMeta(req: Request): authService.SessionMeta {
  return { userAgent: req.get("user-agent"), ipAddress: req.ip };
}
