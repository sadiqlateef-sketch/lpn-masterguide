import { IMAGE_MEDIA_TYPES, type ImageInput, type ImageMediaType } from "./anthropic";
import { ApiError } from "./http";
import type { NoteFile } from "./ingest/notes";
import { check, type UserContext } from "./supabase";

export const LIMITS = {
  files: 10,
  imageBytes: 5 * 1024 * 1024,
  documentBytes: 25 * 1024 * 1024,
  textChars: 500_000,
};

const DOCUMENT_TYPES: Record<string, string> = {
  "application/pdf": "application/pdf",
  "text/markdown": "text/markdown",
  "text/x-markdown": "text/markdown",
  "text/plain": "text/plain",
};

const EXTENSION_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export type UploadedFile = { name: string; mediaType: string; bytes: Uint8Array };

export type ParsedUpload = {
  text: string | null;
  images: (ImageInput & { name: string; bytes: Uint8Array })[];
  documents: NoteFile[];
  fields: Record<string, string>;
};

// Some phones send generic or missing types, so fall back to the file extension.
export function resolveMediaType(name: string, declared: string): string {
  const type = declared.split(";")[0].trim().toLowerCase();
  if ((IMAGE_MEDIA_TYPES as readonly string[]).includes(type) || DOCUMENT_TYPES[type]) return DOCUMENT_TYPES[type] ?? type;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TYPES[ext] ?? type;
}

// Checks the first bytes so a renamed file can't pose as an image or PDF.
export function sniffMatches(mediaType: string, bytes: Uint8Array): boolean {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  switch (mediaType) {
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47);
    case "image/gif":
      return starts(0x47, 0x49, 0x46, 0x38);
    case "image/webp":
      return starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    case "application/pdf":
      return starts(0x25, 0x50, 0x44, 0x46);
    default:
      return true;
  }
}

type ParseOptions = { requireContent?: boolean };

export function sortUploads(
  files: readonly UploadedFile[],
  text: string | null,
  fields: Record<string, string> = {},
  { requireContent = true }: ParseOptions = {},
): ParsedUpload {
  if (files.length > LIMITS.files) throw new ApiError(413, `Add up to ${LIMITS.files} files at a time.`, "too_many_files");
  if (text && text.length > LIMITS.textChars) throw new ApiError(413, "That text is too long. Split it into smaller pieces.", "text_too_long");

  const images: ParsedUpload["images"] = [];
  const documents: NoteFile[] = [];
  for (const file of files) {
    const mediaType = resolveMediaType(file.name, file.mediaType);
    if (/hei[cf]/i.test(mediaType) || /\.hei[cf]$/i.test(file.name)) {
      throw new ApiError(415, "HEIC photos aren't supported yet. Change your camera to JPEG, or take a screenshot of the photo.", "heic");
    }
    if ((IMAGE_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
      if (file.bytes.byteLength > LIMITS.imageBytes) throw new ApiError(413, `"${file.name}" is too big. Photos must be under 5 MB.`, "image_too_big");
      if (!sniffMatches(mediaType, file.bytes)) throw new ApiError(415, `"${file.name}" isn't a real image file.`, "bad_file");
      images.push({ name: file.name, bytes: file.bytes, mediaType: mediaType as ImageMediaType, base64: Buffer.from(file.bytes).toString("base64") });
      continue;
    }
    if (Object.values(DOCUMENT_TYPES).includes(mediaType)) {
      if (file.bytes.byteLength > LIMITS.documentBytes) throw new ApiError(413, `"${file.name}" is too big. Files must be under 25 MB.`, "file_too_big");
      if (!sniffMatches(mediaType, file.bytes)) throw new ApiError(415, `"${file.name}" isn't a real PDF.`, "bad_file");
      documents.push({ name: file.name, mediaType, bytes: file.bytes });
      continue;
    }
    throw new ApiError(415, `"${file.name}" isn't a type I can read. Use a photo, PDF, or text file.`, "unsupported_type");
  }

  const cleanText = text?.trim() || null;
  if (requireContent && !cleanText && images.length === 0 && documents.length === 0) {
    throw new ApiError(400, "Add a photo, a file, or some text first.", "empty");
  }
  return { text: cleanText, images, documents, fields };
}

// Reads JSON ({ text }) or multipart form data (text + files) from a request.
export async function parseUpload(request: Request, options: ParseOptions = {}): Promise<ParsedUpload> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await request.formData();
    const files: UploadedFile[] = [];
    const fields: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") {
        fields[key] = value;
      } else {
        files.push({ name: value.name || "upload", mediaType: value.type, bytes: new Uint8Array(await value.arrayBuffer()) });
      }
    }
    return sortUploads(files, fields.text ?? null, fields, options);
  }
  if (type.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") throw new ApiError(400, "That request wasn't readable.", "bad_json");
    const fields = Object.fromEntries(Object.entries(body).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    return sortUploads([], fields.text ?? null, fields, options);
  }
  throw new ApiError(415, "Send JSON or form data.", "unsupported_body");
}

function safeName(name: string): string {
  return name.normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "file";
}

// Keeps the original upload in the student's private folder. Returns the folder path.
export async function storeOriginals(ctx: UserContext, ingestItemId: string, upload: ParsedUpload): Promise<string | null> {
  const files = [...upload.images, ...upload.documents];
  if (files.length === 0) return null;
  const folder = `${ctx.user.id}/ingest/${ingestItemId}`;
  await Promise.all(
    files.map(async (file, i) =>
      check(
        await ctx.supabase.storage
          .from("uploads")
          .upload(`${folder}/${i + 1}-${safeName(file.name)}`, file.bytes, { contentType: file.mediaType, upsert: false }),
        "store upload",
      ),
    ),
  );
  return folder;
}
