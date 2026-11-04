import sharp from "sharp";
import { rules } from "../../config/rules.js";
import { signPrivateFileUrl } from "../../lib/signed-files.js";
import { AppError } from "../../utils/app-error.js";

const { sizePx, jpegQuality, signedUrlLifetime } = rules.profile.photo;

// Turns an uploaded JPG or PNG into a square JPEG (A7 decision). Re-encoding
// proves the file really is an image and drops every piece of metadata (EXIF,
// including a phone's GPS position): sharp copies none unless asked to.
export async function processProfilePhoto(input: Uint8Array) {
  try {
    return await sharp(input, { failOn: "error", limitInputPixels: 50_000_000 })
      // Applies the EXIF orientation before the EXIF data is dropped.
      .rotate()
      .resize(sizePx, sizePx, { fit: "cover", position: "attention" })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: jpegQuality, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new AppError(415, "IMAGE_UNREADABLE", "This image could not be read. Try another photo");
  }
}

// A signed link to a profile photo, or null when there is none.
export async function photoLink(photoKey: string | null | undefined) {
  if (!photoKey) return null;
  return signPrivateFileUrl(photoKey, Date.now(), signedUrlLifetime);
}
