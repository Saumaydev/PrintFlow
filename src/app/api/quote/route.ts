import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { ApiError, errorResponse, ok } from "@/lib/auth";
import { computeQuote, getActivePricing, type QuoteItem } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const shopId = String(body?.shopId ?? "");
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!shopId) throw new ApiError(400, "BAD_INPUT", "Missing shopId");
    if (items.length === 0) throw new ApiError(400, "BAD_INPUT", "No items to quote");
    if (items.length > 20) throw new ApiError(400, "BAD_INPUT", "Too many items in one order (max 20)");

    const ids = items.map((i: { documentId?: string }) => String(i.documentId ?? "")).filter(Boolean);
    const docs = ids.length > 0 ? await db.select().from(documents).where(and(eq(documents.shopId, shopId), inArray(documents.id, ids))) : [];

    const quoteItems: QuoteItem[] = items.map((raw: Record<string, unknown>) => {
      const documentId = String(raw.documentId ?? "");
      const doc = docs.find((d) => d.id === documentId);
      if (!doc) throw new ApiError(404, "DOC_NOT_FOUND", "One of the uploaded documents was not found. Please re-upload it.");
      const config = (raw.config ?? {}) as QuoteItem["config"];
      return {
        documentId,
        label: String(raw.label ?? doc.fileName),
        pageCount: doc.pageCount,
        kind: doc.kind,
        needsConversion: doc.needsConversion,
        config: {
          copies: Number(config.copies ?? 1),
          colorMode: config.colorMode === "color" ? "color" : "bw",
          paperSize: String(config.paperSize ?? "A4"),
          orientation: (["portrait", "landscape", "auto"].includes(String(config.orientation)) ? config.orientation : "auto") as QuoteItem["config"]["orientation"],
          duplex: (["off", "long", "short"].includes(String(config.duplex)) ? config.duplex : "off") as QuoteItem["config"]["duplex"],
          pagesPerSheet: [1, 2, 4, 6, 9].includes(Number(config.pagesPerSheet)) ? Number(config.pagesPerSheet) : 1,
          pageRange: String(config.pageRange ?? "all"),
          scaling: String(config.scaling ?? "fit"),
          finishing: Array.isArray(config.finishing) ? config.finishing.map(String) : [],
          urgent: Boolean(config.urgent),
        },
      };
    });

    const { rules, version } = await getActivePricing(shopId);
    const quote = computeQuote(rules, quoteItems, version);
    return ok({ quote, rules: { maxCopies: rules.maxCopies, finishing: rules.finishing } });
  } catch (err) {
    if (err instanceof Error && err.message.includes("invalid page range")) {
      return errorResponse(new ApiError(422, "BAD_PAGE_RANGE", err.message));
    }
    return errorResponse(err);
  }
}
