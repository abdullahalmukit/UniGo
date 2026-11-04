import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { rules } from "../config/rules.js";
import { AppError } from "../utils/app-error.js";
import { detectFileType, isAllowedMimeType, type AllowedMimeType } from "../utils/file-type.js";

// Kept in memory (at most 5 MB) until the service has checked everything and
// writes it to private storage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: rules.uploads.maxFileSizeBytes, files: 1, fields: 10 },
});

// Accepts exactly one JPG, PNG or PDF of at most 5 MB in `field`. The declared
// type and the file's own first bytes must both be one of those types, and match.
export function singleDocumentUpload(field: string) {
  return singleUpload(field, rules.uploads.allowedMimeTypes, {
    code: "FILE_TYPE_NOT_ALLOWED",
    message: "Upload a JPG, PNG or PDF file",
  });
}

// The same checks for a picture: JPG or PNG only (A7 profile photo).
export function singleImageUpload(field: string) {
  return singleUpload(field, rules.profile.photo.allowedMimeTypes, {
    code: "IMAGE_TYPE_NOT_ALLOWED",
    message: "Upload a JPG or PNG image",
  });
}

function singleUpload(field: string, allowed: readonly AllowedMimeType[], typeError: { code: string; message: string }) {
  const parse = upload.single(field);

  return (req: Request, res: Response, next: NextFunction) => {
    parse(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError) {
        next(
          error.code === "LIMIT_FILE_SIZE"
            ? new AppError(413, "FILE_TOO_LARGE", "The file must be 5 MB or smaller")
            : new AppError(400, "INVALID_UPLOAD", "Upload one file"),
        );
        return;
      }
      if (error) {
        next(error);
        return;
      }

      const file = req.file;
      if (!file || file.size === 0) {
        next(new AppError(400, "FILE_REQUIRED", "Choose a file to upload"));
        return;
      }
      const declared = file.mimetype;
      if (!isAllowedMimeType(declared) || !allowed.includes(declared) || detectFileType(file.buffer) !== declared) {
        next(new AppError(415, typeError.code, typeError.message));
        return;
      }
      next();
    });
  };
}
