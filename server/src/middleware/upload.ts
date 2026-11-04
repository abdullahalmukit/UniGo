import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { rules } from "../config/rules.js";
import { AppError } from "../utils/app-error.js";
import { detectFileType, isAllowedMimeType } from "../utils/file-type.js";

// Kept in memory (at most 5 MB) until the service has checked everything and
// writes it to private storage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: rules.uploads.maxFileSizeBytes, files: 1, fields: 10 },
});

// Accepts exactly one JPG, PNG or PDF of at most 5 MB in `field`. The declared
// type and the file's own first bytes must both be one of those types, and match.
export function singleDocumentUpload(field: string) {
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
      if (!isAllowedMimeType(file.mimetype) || detectFileType(file.buffer) !== file.mimetype) {
        next(new AppError(415, "FILE_TYPE_NOT_ALLOWED", "Upload a JPG, PNG or PDF file"));
        return;
      }
      next();
    });
  };
}
