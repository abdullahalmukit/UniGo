import { Router } from "express";
import { authenticate, authUser } from "../../middleware/authenticate.js";
import { requireCanAct } from "../../middleware/authorize.js";
import { singleImageUpload } from "../../middleware/upload.js";
import { parseInput, validateBody } from "../../middleware/validate.js";
import { prisma } from "../../lib/prisma.js";
import { putPrivateFile } from "../../lib/private-storage.js";
import { AppError } from "../../utils/app-error.js";
import { rules } from "../../config/rules.js";
import {
  createDispute,
  getDispute,
  listUserDisputes,
} from "./disputes.service.js";
import {
  createDisputeSchema,
  type CreateDisputeInput,
} from "./disputes.validation.js";

export const disputesRouter = Router();
disputesRouter.use(authenticate);

const id = (value: unknown) => String(value);
const me = (req: Parameters<typeof authUser>[0]) => authUser(req).id;

// Raise a dispute or complaint
disputesRouter.post("/", requireCanAct, validateBody(createDisputeSchema), async (req, res) => {
  const dispute = await createDispute(me(req), req.body as CreateDisputeInput);
  res.status(201).json({ dispute });
});

// List my disputes (raised by me or against me)
disputesRouter.get("/my", async (req, res) => {
  res.json({ disputes: await listUserDisputes(me(req)) });
});

// Get dispute details
disputesRouter.get("/:id", async (req, res) => {
  res.json({ dispute: await getDispute(me(req), id(req.params.id)) });
});

// Upload evidence image for dispute
disputesRouter.post(
  "/:id/evidence",
  requireCanAct,
  singleImageUpload("file"),
  async (req, res) => {
    const disputeId = id(req.params.id);
    const userId = me(req);

    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
      select: { id: true, raisedById: true, status: true },
    });

    if (!dispute || dispute.raisedById !== userId) {
      throw new AppError(403, "NOT_DISPUTE_OWNER", "Only the person who raised the dispute can upload evidence");
    }
    if (dispute.status === "RESOLVED") {
      throw new AppError(409, "DISPUTE_CLOSED", "This dispute has already been resolved");
    }

    if (!req.file) throw new AppError(400, "NO_FILE", "Upload an evidence image");

    const fileKey = await putPrivateFile("dispute-evidence", req.file.buffer, req.file.mimetype as any);

    const evidence = await prisma.disputeEvidence.create({
      data: {
        disputeId,
        uploadedById: userId,
        fileKey,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
      },
    });

    res.status(201).json({ evidence });
  },
);

