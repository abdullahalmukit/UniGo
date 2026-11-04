// Throw this from services to send a known error to the client.
// The error handler turns it into { error: { code, message, fields?, ...data } }.
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  // Per-field messages, only for VALIDATION_ERROR.
  readonly fields?: Record<string, string[]>;
  // Extra values the client needs to handle this code (for example a linkToken).
  readonly data?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    extra: { fields?: Record<string, string[]>; data?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.fields = extra.fields;
    this.data = extra.data;
  }
}
