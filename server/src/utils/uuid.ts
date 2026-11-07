import { randomBytes } from "node:crypto";

// A time-ordered UUID v7 (A2 decision 14), the same format as the database
// default. For rows created in bulk with createMany, whose ids the code needs
// before they are written (B6a: carpool sessions and their activities).
export function uuidv7(now = Date.now()) {
  const bytes = randomBytes(16);
  const ms = BigInt(now);
  for (let i = 0; i < 6; i += 1) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
