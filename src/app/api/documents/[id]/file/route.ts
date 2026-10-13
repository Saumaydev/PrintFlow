import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { ApiError, errorResponse, requireStaff } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!doc) throw new ApiError(404, "NOT_FOUND", "Document not found");
    await requireStaff(doc.shopId); // tenant-scoped authorization

    if (doc.filesClearedAt) {
      return Response.json(
        { ok: false, error: { code: "FILE_CLEARED", message: "The source file was securely cleared. Order and print history remain available." } },
        { status: 410 },
      );
    }
    if (!doc.fileData) throw new ApiError(404, "NO_CONTENT", "File content is not available.");

    return new Response(new Uint8Array(doc.fileData), {
      headers: {
        "Content-Type": doc.mime || "application/octet-stream",
        "Content-Disposition": `inline; filename="${encodeURIComponent(doc.fileName)}"`,
        "Content-Length": String(doc.sizeBytes),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
