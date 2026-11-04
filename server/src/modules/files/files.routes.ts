import { Router } from "express";
import { openPrivateFile } from "../../lib/private-storage.js";
import { verifyPrivateFileToken } from "../../lib/signed-files.js";
import { AppError } from "../../utils/app-error.js";

export const filesRouter = Router();

// Opens a private file through a signed link from an admin endpoint. It works
// in an <img> or a new tab, so it needs no Authorization header: the
// short-lived signature is the permission.
filesRouter.get("/:token", async (req, res) => {
  const key = await verifyPrivateFileToken(req.params.token);
  const file = key ? await openPrivateFile(key) : null;
  if (!file) throw new AppError(404, "FILE_LINK_INVALID", "This file link is invalid or has expired");

  res.set({
    "Content-Type": file.mimeType,
    "Content-Length": String(file.size),
    "Content-Disposition": "inline",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-site",
  });
  file.stream.pipe(res);
});
