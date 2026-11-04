import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "../generated/prisma/client.js";
import { AppError } from "../utils/app-error.js";
import { authUser } from "./authenticate.js";

// Each of these runs after `authenticate`.

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!roles.includes(authUser(req).role)) {
      throw new AppError(403, "FORBIDDEN", "You do not have permission to do this");
    }
    next();
  };
}

// Unverified users can only complete their profile and verification.
export function requireVerifiedStudent(req: Request, _res: Response, next: NextFunction) {
  if (authUser(req).studentVerificationStatus !== "VERIFIED") {
    throw new AppError(403, "NOT_VERIFIED", "Verify your student status first");
  }
  next();
}

// RESTRICTED accounts cannot create or accept activities. Use on create, accept
// and book routes. (SUSPENDED and BANNED are already refused by `authenticate`.)
export function requireCanAct(req: Request, _res: Response, next: NextFunction) {
  if (authUser(req).accountStatus === "RESTRICTED") {
    throw new AppError(403, "ACCOUNT_RESTRICTED", "Your account is restricted from creating or accepting activities");
  }
  next();
}
