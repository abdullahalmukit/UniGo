import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/app-error.js";

// Express needs all four parameters to treat this as an error handler.
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof AppError) {
    const { code, message, fields, data } = error;
    res.status(error.status).json({ error: { ...data, code, message, ...(fields && { fields }) } });
    return;
  }

  if (isInvalidJsonBody(error)) {
    res.status(400).json({ error: { code: "INVALID_JSON", message: "Request body is not valid JSON" } });
    return;
  }

  console.error(`Unhandled error on ${req.method} ${req.path}:`, error);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong" } });
}

function isInvalidJsonBody(error: unknown) {
  return typeof error === "object" && error !== null && "type" in error && error.type === "entity.parse.failed";
}
