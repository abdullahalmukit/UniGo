import "dotenv/config";
import { z } from "zod";

const DURATION_UNITS_MS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };

// "15m", "30d" -> milliseconds
const duration = z
  .string()
  .regex(/^\d+[smhd]$/, "Use a number followed by s, m, h or d, for example 15m")
  .transform((value) => Number(value.slice(0, -1)) * DURATION_UNITS_MS[value.slice(-1) as "s" | "m" | "h" | "d"]);

const optionalText = z.string().trim().min(1).optional();

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    CLIENT_URL: z.url().default("http://localhost:5173"),
    DATABASE_URL: z.string().startsWith("mysql://", "DATABASE_URL must start with mysql://"),
    DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
    JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
    JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
    JWT_ACCESS_EXPIRES_IN: duration.prefault("15m"),
    JWT_REFRESH_EXPIRES_IN: duration.prefault("30d"),
    // Signs the short-lived links to private files (A6). At least 32 characters.
    FILE_SIGNING_SECRET: z.string().min(32, "FILE_SIGNING_SECRET must be at least 32 characters"),
    // Folder for private uploads; never served as static files.
    PRIVATE_STORAGE_DIR: z.string().trim().min(1).default("storage/private"),
    // Dev-only seed: the SUPER_ADMIN account (prisma/seed.ts)
    SEED_ADMIN_EMAIL: z.string().trim().toLowerCase().pipe(z.email()).optional(),
    SEED_ADMIN_PASSWORD: optionalText,
    GOOGLE_CLIENT_ID: z.string().trim().min(1, "GOOGLE_CLIENT_ID is required for Google sign-in"),
    // Development only: "console" (default) or "smtp". Production always uses
    // SMTP and tests always use the in-memory outbox.
    EMAIL_TRANSPORT: z.enum(["console", "smtp"]).optional(),
    SMTP_HOST: optionalText,
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: optionalText,
    SMTP_PASSWORD: optionalText,
    MAIL_FROM: optionalText,
    // B2a: Redis for BullMQ background jobs (Memurai on Windows). Tests never
    // connect; they use the in-memory job scheduler.
    REDIS_URL: z.string().trim().regex(/^rediss?:\/\//, "REDIS_URL must start with redis:// or rediss://").default("redis://localhost:6379"),
    // B2c: Web Push keys. Required in production; without them in development
    // push is off. Tests use the in-memory push transport.
    VAPID_PUBLIC_KEY: optionalText,
    VAPID_PRIVATE_KEY: optionalText,
    VAPID_SUBJECT: z
      .string()
      .trim()
      .regex(/^(mailto:|https:\/\/)/, "VAPID_SUBJECT must start with mailto: or https://")
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      ctx.addIssue({ code: "custom", path: ["JWT_REFRESH_SECRET"], message: "Must be different from JWT_ACCESS_SECRET" });
    }
    if (value.FILE_SIGNING_SECRET === value.JWT_ACCESS_SECRET || value.FILE_SIGNING_SECRET === value.JWT_REFRESH_SECRET) {
      ctx.addIssue({ code: "custom", path: ["FILE_SIGNING_SECRET"], message: "Must be different from the JWT secrets" });
    }
    if (value.NODE_ENV === "production" && value.EMAIL_TRANSPORT === "console") {
      ctx.addIssue({ code: "custom", path: ["EMAIL_TRANSPORT"], message: "Production always sends email by SMTP" });
    }
    if (emailTransportFor(value) === "smtp") {
      for (const key of ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "MAIL_FROM"] as const) {
        if (!value[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required to send email by SMTP` });
      }
    }
    const vapid = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;
    const given = vapid.filter((key) => value[key]);
    if (value.NODE_ENV === "production" || given.length > 0) {
      for (const key of vapid) {
        if (!value[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required for Web Push` });
      }
    }
  })
  .transform((value) => ({
    ...value,
    emailTransport: emailTransportFor(value),
    // Tests record scheduled jobs in memory; everywhere else BullMQ runs them.
    jobsDriver: value.NODE_ENV === "test" ? ("memory" as const) : ("bullmq" as const),
    // Tests record pushes in memory; without VAPID keys push is off.
    pushTransport:
      value.NODE_ENV === "test"
        ? ("memory" as const)
        : value.VAPID_PUBLIC_KEY && value.VAPID_PRIVATE_KEY && value.VAPID_SUBJECT
          ? ("webpush" as const)
          : ("off" as const),
  }));

function emailTransportFor(value: { NODE_ENV: string; EMAIL_TRANSPORT?: "console" | "smtp" }) {
  if (value.NODE_ENV === "test") return "memory" as const;
  if (value.NODE_ENV === "production") return "smtp" as const;
  return value.EMAIL_TRANSPORT ?? ("console" as const);
}

export function parseEnv(source: Record<string, string | undefined>) {
  return envSchema.safeParse(source);
}

const result = parseEnv(process.env);

if (!result.success) {
  console.error("Invalid environment variables. Check server/.env against .env.example.");
  console.error(z.prettifyError(result.error));
  process.exit(1);
}

export const env = result.data;
