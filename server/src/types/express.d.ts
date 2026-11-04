import type {
  AccountStatus,
  StudentVerificationStatus,
  UserRole,
} from "../generated/prisma/client.js";

declare global {
  namespace Express {
    interface Request {
      // Set by the `authenticate` middleware. accountStatus is the effective
      // status (an expired suspension counts as ACTIVE).
      user?: {
        id: string;
        role: UserRole;
        accountStatus: AccountStatus;
        studentVerificationStatus: StudentVerificationStatus;
        isVerifiedRider: boolean;
        riderActive: boolean;
      };
    }
  }
}

export {};
