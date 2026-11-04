import { rules } from "../config/rules.js";

export type AllowedMimeType = (typeof rules.uploads.allowedMimeTypes)[number];

// Signatures of the only file types UniGo accepts. The browser's declared type
// is never trusted on its own.
const SIGNATURES: { mimeType: AllowedMimeType; bytes: number[] }[] = [
  { mimeType: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mimeType: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mimeType: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
];

// The real type of the file from its first bytes, or null when it is none of
// JPG, PNG or PDF.
export function detectFileType(buffer: Uint8Array): AllowedMimeType | null {
  const match = SIGNATURES.find(({ bytes }) => bytes.every((byte, index) => buffer[index] === byte));
  return match?.mimeType ?? null;
}

export function isAllowedMimeType(value: string): value is AllowedMimeType {
  return (rules.uploads.allowedMimeTypes as readonly string[]).includes(value);
}
