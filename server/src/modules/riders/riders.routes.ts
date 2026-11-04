import { Router } from "express";
import { rules } from "../../config/rules.js";
import { authenticate, authUser } from "../../middleware/authenticate.js";
import { riderApplicationRateLimit } from "../../middleware/rate-limit.js";
import { multiFileUpload } from "../../middleware/upload.js";
import { validateBody } from "../../middleware/validate.js";
import { AppError } from "../../utils/app-error.js";
import { getRiderDashboard, getRiderOverview, setRiderActive, submitApplication } from "./riders.service.js";
import { applicationDataSchema, setActiveSchema } from "./riders.validation.js";

// Drive with UniGo for the logged-in user (proposal section 6, B1). Applying
// needs a VERIFIED student (checked in the service, with its own error code).
export const riderRouter = Router();
riderRouter.use(authenticate);

const documents = rules.uploads.allowedMimeTypes;
const upload = multiFileUpload([
  { name: "nidFront", maxCount: 1, allowed: documents },
  { name: "nidBack", maxCount: 1, allowed: documents },
  { name: "carLicence", maxCount: 1, allowed: documents },
  { name: "motorcycleLicence", maxCount: 1, allowed: documents },
  { name: "vehiclePhotos", maxCount: rules.rider.maxVehiclesPerApplication, allowed: rules.rider.vehiclePhoto.allowedMimeTypes },
]);

riderRouter.get("/", async (req, res) => {
  res.json(await getRiderOverview(authUser(req).id));
});

riderRouter.post("/applications", riderApplicationRateLimit, upload, async (req, res) => {
  // The form fields come as one JSON part named "data".
  let raw: unknown;
  try {
    raw = JSON.parse(String(req.body?.data ?? ""));
  } catch {
    throw new AppError(400, "VALIDATION_ERROR", "Some fields are invalid", { fields: { data: ["Send the form data"] } });
  }
  // Field errors keep their full path (vehicles.0.seatCapacity), so the form
  // can show each one under its own field.
  const parsed = applicationDataSchema().safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) (fields[issue.path.join(".") || "data"] ??= []).push(issue.message);
    throw new AppError(400, "VALIDATION_ERROR", "Some fields are invalid", { fields });
  }
  const data = parsed.data;
  const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  const one = (name: string) => files[name]?.[0];

  res.status(201).json(
    await submitApplication(authUser(req).id, data, {
      nidFront: one("nidFront"),
      nidBack: one("nidBack"),
      carLicence: one("carLicence"),
      motorcycleLicence: one("motorcycleLicence"),
      vehiclePhotos: files.vehiclePhotos ?? [],
    }),
  );
});

riderRouter.patch("/active", validateBody(setActiveSchema), async (req, res) => {
  res.json(await setRiderActive(authUser(req).id, req.body.active));
});

riderRouter.get("/dashboard", async (req, res) => {
  res.json(await getRiderDashboard(authUser(req).id));
});
