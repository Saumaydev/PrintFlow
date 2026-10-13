import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents, shops } from "@/db/schema";
import { ApiError, errorResponse, getSessionUser, ok } from "@/lib/auth";
import { countPdfPages, fileKind, MAX_PDF_PAGES, MAX_UPLOAD_BYTES, sha256, validateMagicBytes } from "@/lib/files";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const form = await req.formData().catch(() => null);
    if (!form) throw new ApiError(400, "BAD_INPUT", "Expected multipart form data");
    const shopId = String(form.get("shopId") ?? "");
    const file = form.get("file");
    if (!shopId) throw new ApiError(400, "BAD_INPUT", "Missing shopId");
    if (!(file instanceof File)) throw new ApiError(400, "BAD_INPUT", "Missing file");

    const shopRows = await db.select({ id: shops.id }).from(shops).where(eq(shops.id, shopId)).limit(1);
    if (shopRows.length === 0) throw new ApiError(404, "NOT_FOUND", "Shop not found");

    if (file.size === 0) throw new ApiError(400, "EMPTY_FILE", "The selected file is empty.");
    if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, "FILE_TOO_LARGE", `File is too large. Maximum size is ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);

    const detected = fileKind(file.name, file.type);
    if (!detected) {
      throw new ApiError(415, "UNSUPPORTED_TYPE", "Unsupported file type. Accepted: PDF, JPG, PNG, WebP, DOC, DOCX, PPT, PPTX, XLS, XLSX, TXT.");
    }

    const buf = new Uint8Array(await file.arrayBuffer());
    const magicError = validateMagicBytes(buf, detected.kind);
    if (magicError) throw new ApiError(422, "INVALID_FILE", magicError);

    let pageCount: number | null = null;
    let needsConversion = false;
    let status = "ready";
    let errorNote: string | null = null;

    if (detected.kind === "pdf") {
      pageCount = countPdfPages(buf);
      if (pageCount > MAX_PDF_PAGES) throw new ApiError(422, "TOO_MANY_PAGES", `This PDF has ${pageCount} pages. Maximum is ${MAX_PDF_PAGES}.`);
      if (pageCount === 0) pageCount = 1;
    } else if (detected.kind === "image") {
      pageCount = 1;
    } else {
      // Office documents are accepted and converted to PDF by the shop's print pipeline.
      needsConversion = true;
      pageCount = null;
      status = "ready";
    }

    const user = await getSessionUser();
    const [doc] = await db
      .insert(documents)
      .values({
        shopId,
        orderId: null,
        fileName: file.name,
        mime: file.type || "application/octet-stream",
        ext: detected.ext,
        kind: detected.kind,
        sizeBytes: file.size,
        checksum: sha256(buf),
        pageCount,
        needsConversion,
        status,
        errorNote,
        fileData: buf,
        createdBy: user?.id ?? null,
      })
      .returning({ id: documents.id });

    return ok({
      document: {
        id: doc.id,
        fileName: file.name,
        ext: detected.ext,
        kind: detected.kind,
        sizeBytes: file.size,
        pageCount,
        needsConversion,
        status,
        errorNote,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
