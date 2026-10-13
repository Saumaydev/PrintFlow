import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, idempotencyRecords, orderEvents, orderItems, orders, printJobs, shops } from "@/db/schema";
import { ApiError, errorResponse, ok } from "@/lib/auth";
import { computeQuote, getActivePricing, type QuoteItem } from "@/lib/pricing";
import { randomToken } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const shopId = String(body?.shopId ?? "");
    const customerName = String(body?.customerName ?? "").trim();
    const phone = String(body?.phone ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase() || null;
    const note = String(body?.note ?? "").trim() || null;
    const paymentMethod = body?.paymentMethod === "online" ? "online" : "counter";
    const idempotencyKey = String(body?.idempotencyKey ?? "") || null;
    const rawItems = Array.isArray(body?.items) ? body.items : [];

    if (!shopId) throw new ApiError(400, "BAD_INPUT", "Missing shop");
    if (customerName.length < 2) throw new ApiError(400, "BAD_INPUT", "Please enter the customer's name.");
    if (rawItems.length === 0) throw new ApiError(400, "BAD_INPUT", "Add at least one document before placing the order.");
    if (rawItems.length > 20) throw new ApiError(400, "BAD_INPUT", "Maximum 20 documents per order.");

    const [shop] = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
    if (!shop) throw new ApiError(404, "NOT_FOUND", "Shop not found");
    const profile = shop.profile as Record<string, unknown>;
    if (profile.acceptOrders === false) throw new ApiError(403, "SHOP_CLOSED", "This shop is not accepting orders right now.");
    if (paymentMethod === "online" && profile.acceptOnlinePayments === false) throw new ApiError(400, "BAD_INPUT", "Online payment is not enabled for this shop.");
    if (paymentMethod === "counter" && profile.acceptCounterPayments === false) throw new ApiError(400, "BAD_INPUT", "Pay-at-counter is not enabled for this shop.");

    // Idempotency: same key returns the original order instead of creating a duplicate.
    if (idempotencyKey) {
      const [existing] = await db
        .select()
        .from(idempotencyRecords)
        .where(and(eq(idempotencyRecords.scope, `order:${shopId}`), eq(idempotencyRecords.key, idempotencyKey)))
        .limit(1);
      if (existing) return ok({ order: existing.result });
    }

    const ids = rawItems.map((i: { documentId?: string }) => String(i.documentId ?? "")).filter(Boolean);
    const docs = await db.select().from(documents).where(and(eq(documents.shopId, shopId), inArray(documents.id, ids)));
    for (const item of rawItems) {
      const doc = docs.find((d) => d.id === String(item.documentId ?? ""));
      if (!doc) throw new ApiError(404, "DOC_NOT_FOUND", "One of the uploaded documents was not found. Please re-upload it.");
      if (doc.orderId) throw new ApiError(409, "DOC_USED", `“${doc.fileName}” is already part of another order.`);
      if (doc.filesClearedAt) throw new ApiError(410, "FILE_CLEARED", `“${doc.fileName}” is no longer available.`);
    }

    // Server-authoritative quote — never trust a client-computed total.
    const quoteItems: QuoteItem[] = rawItems.map((raw: Record<string, unknown>) => {
      const doc = docs.find((d) => d.id === String(raw.documentId))!;
      const config = (raw.config ?? {}) as QuoteItem["config"];
      return {
        documentId: doc.id,
        label: String(raw.label ?? doc.fileName),
        pageCount: doc.pageCount,
        kind: doc.kind,
        needsConversion: doc.needsConversion,
        config: {
          copies: Math.max(1, Math.min(Number(config.copies ?? 1), 50)),
          colorMode: config.colorMode === "color" ? "color" : "bw",
          paperSize: String(config.paperSize ?? "A4"),
          orientation: "auto",
          duplex: (["off", "long", "short"].includes(String(config.duplex)) ? config.duplex : "off") as QuoteItem["config"]["duplex"],
          pagesPerSheet: [1, 2, 4, 6, 9].includes(Number(config.pagesPerSheet)) ? Number(config.pagesPerSheet) : 1,
          pageRange: String(config.pageRange ?? "all"),
          scaling: String(config.scaling ?? "fit"),
          finishing: Array.isArray(config.finishing) ? config.finishing.map(String).filter((k) => k) : [],
          urgent: Boolean(config.urgent),
        },
      };
    });
    const { rules, version } = await getActivePricing(shopId);
    let quote;
    try {
      quote = computeQuote(rules, quoteItems, version);
    } catch (e) {
      throw new ApiError(422, "QUOTE_FAILED", e instanceof Error ? e.message : "Could not compute quote");
    }

    const prefix = String((profile.orderPrefix as string) ?? "PF");
    const result = await db.transaction(async (tx) => {
      const [seqRow] = await tx.update(shops).set({ orderSeq: sql`${shops.orderSeq} + 1` }).where(eq(shops.id, shopId)).returning({ seq: shops.orderSeq });
      const orderNumber = `${prefix}-${seqRow.seq}`;
      const token = randomToken(20);
      const [order] = await tx
        .insert(orders)
        .values({
          shopId,
          orderNumber,
          token,
          customerName,
          phone: phone || null,
          email,
          note,
          status: "awaiting_payment",
          paymentMethod,
          paymentStatus: "pending",
          currency: quote.currency,
          subtotal: quote.subtotal,
          taxAmount: quote.taxAmount,
          total: quote.total,
          pricingVersion: version,
          priceSnapshot: { rules: { taxRate: rules.taxRate, bwPerPage: rules.bwPerPage, colorPerPage: rules.colorPerPage }, lines: quote.lines },
          idempotencyKey,
        })
        .returning();

      for (const qi of quoteItems) {
        const line = quote.lines.find((l) => l.documentId === qi.documentId)!;
        const [item] = await tx
          .insert(orderItems)
          .values({ orderId: order.id, shopId, documentId: qi.documentId, label: qi.label, config: qi.config, pages: line.printablePages, sheets: line.sheets, lineTotal: line.lineTotal })
          .returning();
        await tx.insert(printJobs).values({
          shopId,
          orderId: order.id,
          itemId: item.id,
          documentId: qi.documentId,
          label: qi.label,
          kind: "order",
          status: "awaiting_payment",
          priority: qi.config.urgent ? 1 : 3,
          testMode: false,
          configSnapshot: qi.config,
        });
        await tx.update(documents).set({ orderId: order.id }).where(eq(documents.id, qi.documentId));
      }
      await tx.insert(orderEvents).values({ orderId: order.id, type: "received", actor: "customer", note: `Order placed (${paymentMethod === "online" ? "online payment" : "pay at counter"})` });

      const payload = { orderId: order.id, orderNumber, token, total: order.total, currency: order.currency, paymentMethod, status: order.status };
      if (idempotencyKey) {
        await tx.insert(idempotencyRecords).values({ scope: `order:${shopId}`, key: idempotencyKey, result: payload });
      }
      return payload;
    });

    return ok({ order: result });
  } catch (err) {
    return errorResponse(err);
  }
}
