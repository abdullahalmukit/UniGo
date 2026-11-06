// Phone photos are often larger than the 5 MB upload limit. Before uploading,
// a photo is drawn at most MAX_SIDE pixels wide or high (food chat receipts:
// 1600, so the text stays readable) and saved as JPEG.
// The server re-encodes it again anyway (and removes EXIF data), so this only
// saves time and data. Anything the browser cannot draw is sent unchanged and
// the server answers with the right error.
const MAX_SIDE = 1024;

export async function shrinkImage(file: File, maxSide = MAX_SIDE): Promise<Blob> {
  if (!/^image\/(jpeg|png)$/.test(file.type) || typeof createImageBitmap !== "function") return file;
  try {
    // Applies the photo's EXIF orientation.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    return blob ?? file;
  } catch {
    return file;
  }
}
