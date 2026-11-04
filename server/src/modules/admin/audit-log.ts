import type { Prisma } from "../../generated/prisma/client.js";

export type AuditEntry = {
  adminId: string;
  action: string;
  targetType: string;
  targetId?: string;
  targetUserId?: string;
  oldValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
  ipAddress?: string;
};

// Writes one read-only Audit Log row (proposal section 17). Call it inside the
// same transaction as the change it records, so one never exists without the other.
// Never put tokens, passwords or document URLs in the values.
export function recordAudit(db: Prisma.TransactionClient, entry: AuditEntry) {
  return db.auditLog.create({ data: entry });
}
