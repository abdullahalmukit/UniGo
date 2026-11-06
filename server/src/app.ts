import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { activitiesRouter } from "./modules/activities/activities.routes.js";
import { chatRouter, reportsRouter } from "./modules/chat/chat.routes.js";
import { notFound } from "./middleware/not-found.js";
import { adminRouter } from "./modules/admin/admin.routes.js";
import { adminStudentVerificationsRouter } from "./modules/admin/student-verifications.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { filesRouter } from "./modules/files/files.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { subAreasRouter } from "./modules/subareas/subareas.routes.js";
import { adminUniversitiesRouter } from "./modules/universities/universities.admin.routes.js";
import { universitiesRouter } from "./modules/universities/universities.routes.js";
import { adminRiderApplicationsRouter, adminRidersRouter } from "./modules/riders/riders.admin.routes.js";
import { riderRouter } from "./modules/riders/riders.routes.js";
import { meRouter } from "./modules/users/me.routes.js";
import { verificationRouter } from "./modules/verification/verification.routes.js";

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/universities", universitiesRouter);
app.use("/api/me", meRouter);
app.use("/api/sub-areas", subAreasRouter);
app.use("/api/rider", riderRouter);
app.use("/api/activities", activitiesRouter);
app.use("/api/chats", chatRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/verification", verificationRouter);
app.use("/api/files", filesRouter);
app.use("/api/admin/student-verifications", adminStudentVerificationsRouter);
app.use("/api/admin/universities", adminUniversitiesRouter);
app.use("/api/admin/rider-applications", adminRiderApplicationsRouter);
app.use("/api/admin/riders", adminRidersRouter);
app.use("/api/admin", adminRouter);

app.use(notFound);
app.use(errorHandler);
