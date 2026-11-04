import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../utils/app-error.js";

// Parses req.body with the schema and replaces it with the parsed (trimmed,
// normalised) value. Sends VALIDATION_ERROR with per-field messages on failure.
export function validateBody(schema: z.ZodType) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body ?? {});

    if (!result.success) {
      const { fieldErrors } = z.flattenError(result.error);
      next(
        new AppError(400, "VALIDATION_ERROR", "Some fields are invalid", {
          fields: fieldErrors as Record<string, string[]>,
        }),
      );
      return;
    }

    req.body = result.data;
    next();
  };
}
