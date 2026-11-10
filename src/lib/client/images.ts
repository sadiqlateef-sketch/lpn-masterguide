// Camera photos are often 4000px+ and several MB. Shrinking them before upload keeps them under the
// server's 5 MB photo limit and makes Magic Add much faster on mobile data.

const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.85;
const SERVER_LIMIT = 5 * 1024 * 1024;
const PASS_THROUGH = ["image/jpeg", "image/png", "image/webp"];

function isHeic(file: File) {
  return /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
}

export async function prepareImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") && !isHeic(file)) return file;
  // Animated GIFs would lose their frames; send them as they are.
  if (file.type === "image/gif") return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // The browser can't decode it (usually HEIC outside Safari). Let the server explain.
    if (isHeic(file)) throw new Error("This photo is in HEIC format. Set your camera to JPEG (Most Compatible), or take a screenshot of the photo.");
    return file;
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const smallEnough = scale === 1 && file.size <= SERVER_LIMIT && PASS_THROUGH.includes(file.type);
  if (smallEnough) {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return file;
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await toBlob(canvas);
  if (!blob) return file;
  const name = file.name.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${name}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

export async function prepareImages(files: readonly File[]): Promise<File[]> {
  return Promise.all(files.map(prepareImage));
}
