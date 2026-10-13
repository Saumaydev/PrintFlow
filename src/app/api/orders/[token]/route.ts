import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { documents, orderEvents, orderItems, orders, payments, printJobs, shops } from "@/db/schema";
import { ApiError, errorResponse, ok } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const [order] = await db.select().from(orders).where(eq(orders.token, token)).limit(1);
    if (!order) throw new ApiError(404, "NOT_FOUND", "Order not found. Check the link from your confirmation screen.");
    const [shop] = await db.select({ id: shops.id, name: shops.name, slug: shops.slug, profile: shops.profile }).from(shops).where(eq(shops.id, order.shopId)).limit(1);

    const [items, pays, jobs, events] = await Promise.all([
      db.select().from(orderItems).where(eq(orderItems.orderId, order.id)).orderBy(asc(orderItems.createdAt)),
      db.select().from(payments).where(eq(payments.orderId, order.id)).orderBy(desc(payments.createdAt)),
      db.select().from(printJobs).where(eq(printJobs.orderId, order.id)),
      db.select().from(orderEvents).where(eq(orderEvents.orderId, order.id)).orderBy(asc(orderEvents.createdAt)),
    ]);
    const docIds = items.map((i) => i.documentId).filter(Boolean) as string[];
    const docs = docIds.length > 0 ? await db.select({ id: documents.id, fileName: documents.fileName, filesClearedAt: documents.filesClearedAt, needsConversion: documents.needsConversion }).from(documents).where(inArray(documents.id, docIds)) : [];

    return ok({
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        token: order.token,
        customerName: order.customerName,
        status: order.status,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        currency: order.currency,
        subtotal: order.subtotal,
        taxAmount: order.taxAmount,
        total: order.total,
        note: order.note,
        createdAt: order.createdAt,
      },
      shop: shop ? { name: shop.name, slug: shop.slug, address: (shop.profile as Record<string, unknown>).address ?? "", phone: (shop.profile as Record<string, unknown>).phone ?? "" } : null,
      items: items.map((i) => {
        const doc = docs.find((d) => d.id === i.documentId);
        return {
          id: i.id,
          label: i.label,
          config: i.config,
          pages: i.pages,
          sheets: i.sheets,
          lineTotal: i.lineTotal,
          fileCleared: doc?.filesClearedAt ? true : false,
          needsConversion: doc?.needsConversion ?? false,
        };
      }),
      payments: pays.map((p) => ({ id: p.id, provider: p.provider, method: p.method, amount: p.amount, status: p.status, createdAt: p.createdAt, providerRef: p.provider ? p.providerRef : null })),
      jobs: jobs.map((j) => ({
        id: j.id,
        status: j.status,
        progressStage: j.progressStage,
        testMode: j.testMode,
        errorReason: j.errorReason,
        createdAt: j.createdAt,
        startedAt: j.startedAt,
        completedAt: j.completedAt,
      })),
      timeline: events.map((e) => ({ type: e.type, note: e.note, actor: e.actor, createdAt: e.createdAt })),
      canPayOnline: order.paymentStatus === "pending" && order.paymentMethod === "online",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
