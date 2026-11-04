import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import {
  forgotPasswordEmailRateLimit,
  forgotPasswordIpRateLimit,
  googleRateLimit,
  loginRateLimit,
  refreshRateLimit,
  registerRateLimit,
  resetPasswordRateLimit,
} from "../../middleware/rate-limit.js";
import { validateBody } from "../../middleware/validate.js";
import * as controller from "./auth.controller.js";
import {
  forgotPasswordSchema,
  googleLinkSchema,
  googleRegisterSchema,
  googleSignInSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "./auth.validation.js";

export const authRouter = Router();

authRouter.post("/register", registerRateLimit, validateBody(registerSchema), controller.register);
authRouter.post("/login", loginRateLimit, validateBody(loginSchema), controller.login);
authRouter.post("/refresh", refreshRateLimit, controller.refresh);
authRouter.post("/logout", controller.logout);
authRouter.post("/logout-all", authenticate, controller.logoutAll);
authRouter.get("/me", authenticate, controller.me);

authRouter.post(
  "/forgot-password",
  forgotPasswordIpRateLimit,
  forgotPasswordEmailRateLimit,
  validateBody(forgotPasswordSchema),
  controller.forgotPassword,
);
authRouter.post("/reset-password", resetPasswordRateLimit, validateBody(resetPasswordSchema), controller.resetPassword);

authRouter.post("/google", googleRateLimit, validateBody(googleSignInSchema), controller.googleSignIn);
authRouter.post("/google/register", googleRateLimit, validateBody(googleRegisterSchema), controller.googleRegister);
authRouter.post("/google/link", googleRateLimit, validateBody(googleLinkSchema), controller.googleLink);
