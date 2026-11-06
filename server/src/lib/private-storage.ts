import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import type { AllowedMimeType } from "../utils/file-type.js";

// Private files: student ID cards, profile photos, rider documents (NID and
// licences), vehicle photos and food chat images (B2b). Kept on local
// disk outside anything served statically, and opened only through a signed
// link (signed-files.ts). Moving to object storage later only changes this file.

const root = path.resolve(env.PRIVATE_STORAGE_DIR);

const EXTENSIONS: Record<AllowedMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

const MIME_BY_EXTENSION: Record<string, AllowedMimeType> = { jpg: "image/jpeg", png: "image/png", pdf: "application/pdf" };

export type PrivateFolder = "student-id-cards" | "profile-photos" | "rider-documents" | "vehicle-photos" | "chat-images";

// "<folder>/<uuid>.<ext>" is the only shape a key can have, so a key can never
// point outside the storage folder.
const KEY = /^([a-z-]+)\/([0-9a-f-]{36})\.(jpg|png|pdf)$/;

// Saves the file under a random name (the original name is never kept) and
// returns its key.
export async function putPrivateFile(folder: PrivateFolder, data: Uint8Array, mimeType: AllowedMimeType) {
  const key = `${folder}/${randomUUID()}.${EXTENSIONS[mimeType]}`;
  await mkdir(path.join(root, folder), { recursive: true });
  await writeFile(path.join(root, key), data, { flag: "wx" });
  return key;
}

// The file type from its key, or null for an invalid key.
export function mimeTypeForKey(key: string): AllowedMimeType | null {
  const match = key.match(KEY);
  return match ? MIME_BY_EXTENSION[match[3]] : null;
}

export async function deletePrivateFile(key: string) {
  if (!KEY.test(key)) return;
  await rm(path.join(root, key), { force: true });
}

// The file's stream, type and size, or null when the key is invalid or the
// file is gone.
export async function openPrivateFile(key: string) {
  const match = key.match(KEY);
  if (!match) return null;
  const filePath = path.join(root, key);
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) return null;
  return { stream: createReadStream(filePath), mimeType: MIME_BY_EXTENSION[match[3]], size: info.size };
}
