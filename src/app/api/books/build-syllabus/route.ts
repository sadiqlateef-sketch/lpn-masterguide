import { z } from "zod";
import { COURSE_IDS } from "@/lib/blueprint-ids";
import { buildSyllabus } from "@/lib/server/books/syllabus";
import { ApiError, json, route } from "@/lib/server/http";
import { bookMessage } from "@/lib/server/ingest/router";
import { requireUser } from "@/lib/server/supabase";
import { parseUpload } from "@/lib/server/uploads";

export const runtime = "nodejs";
export const maxDuration = 300;

const FieldsSchema = z.object({
  title: z.string().max(300).optional(),
  isbn: z.string().max(40).optional(),
  tocText: z.string().max(100_000).optional(),
  courseId: z.enum(COURSE_IDS).optional(),
});

// POST JSON { title?, isbn?, tocText?, courseId? }, or multipart form data with the same fields plus
// photos of the book's cover and table of contents pages (in page order).
export const POST = route(async (request: Request) => {
  const ctx = await requireUser(request);
  const upload = await parseUpload(request, { requireContent: false });
  const fields = FieldsSchema.parse({ ...upload.fields, ...(upload.fields.text && !upload.fields.title ? { title: upload.fields.text } : {}) });
  if (upload.documents.length > 0) {
    throw new ApiError(415, "Send photos of the table of contents, not documents.", "unsupported_type");
  }
  if (!fields.title && !fields.isbn && !fields.tocText && upload.images.length === 0) {
    throw new ApiError(400, "Type the book's title or ISBN, or add photos of its cover and table of contents.", "empty");
  }

  const result = await buildSyllabus(ctx, {
    title: fields.title,
    isbn: fields.isbn,
    tocText: fields.tocText,
    photos: upload.images,
    courseId: fields.courseId,
  });
  return json({ ...result, message: bookMessage(result) }, result.status === "created" ? 201 : 200);
});
