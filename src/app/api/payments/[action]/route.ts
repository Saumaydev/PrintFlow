import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, payments, shops } from "@/db/schema";
import { ApiError, errorResponse, ok } from "@/lib/auth";
import { addOrderEvent, audit, releaseOrderAfterPayment } from "@/lib/service";

export const dynamic = "force-dynamic";

const CASHFREE_ID = process.env.CASHFREE_APP_ID;
const CASHFREE_SECRET = process.env.CASHFREE_APP_SECRET;
const cashfreeLive = process.env.CASHFREE_ENV === "production";
const CASHFREE_BASE = cashfreeLive ? "https://api.cashfree.com" : "https://sandbox.cashfree.com";

async function orderByToken(token: string) {
  const [order] = await db.select().from(orders).where(eq(orders.token, token)).limit(1);
  if (!order) throw new ApiError(404, "NOT_FOUND", "Order not found");
  return order;
}

export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    const { action } = await params;

    // ---------- create checkout (online payment) ----------
    if (action === "checkout") {
      const body = await req.json().catch(() => ({}));
      const order = await orderByToken(String(body?.orderToken ?? ""));
      if (order.paymentStatus === "paid") throw new ApiError(409, "ALREADY_PAID", "This order is already paid.");

      if (CASHFREE_ID && CASHFREE_SECRET) {
        const cfOrderId = `pf_${order.id.replace(/-/g, "").slice(0, 24)}`;
        const res = await fetch(`${CASHFREE_BASE}/pg/orders`, {
          method: "POST",
          headers: {
            "x-client-id": CASHFREE_ID,
            "x-client-secret": CASHFREE_SECRET,
            "x-api-version": "2022-09-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            order_id: cfOrderId,
            order_amount: (order.total / 100).toFixed(2),
            order_currency: order.currency,
            customer_details: {
              customer_id: order.token.slice(0, 16),
              customer_name: order.customerName,
              customer_phone: order.phone ?? "9999999999",
              customer_email: order.email ?? "customer@example.com",
            },
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.payment_session_id) {
          throw new ApiError(502, "PROVIDER_ERROR", "Payment provider rejected the request. Please try pay-at-counter or retry.", true);
        }
        await db.insert(payments).values({
          shopId: order.shopId,
          orderId: order.id,
          provider: "cashfree",
          method: "online",
          providerRef: cfOrderId,
          amount: order.total,
          currency: order.currency,
          status: "pending",
        });
        await addOrderEvent(order.id, "payment_initiated", "customer", "Cashfree checkout started");
        return ok({ mode: "cashfree", paymentSessionId: data.payment_session_id, orderToken: order.token });
      }

      // Sandbox gateway (no provider keys configured)
      const [payment] = await db
        .insert(payments)
        .values({
          shopId: order.shopId,
          orderId: order.id,
          provider: "sandbox",
          method: "online",
          providerRef: `SBX-${Date.now().toString(36).toUpperCase()}`,
          amount: order.total,
          currency: order.currency,
          status: "pending",
        })
        .returning();
      await addOrderEvent(order.id, "payment_initiated", "customer", "Sandbox checkout started (no Cashfree keys configured)");
      return ok({ mode: "sandbox", paymentId: payment.id, amount: order.total, currency: order.currency });
    }

    // ---------- sandbox confirmation (simulated provider verification) ----------
    if (action === "confirm") {
      const body = await req.json().catch(() => ({}));
      const order = await orderByToken(String(body?.orderToken ?? ""));
      const paymentId = String(body?.paymentId ?? "");
      const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
      if (!payment || payment.orderId !== order.id) throw new ApiError(404, "NOT_FOUND", "Payment not found");
      if (payment.provider !== "sandbox") throw new ApiError(400, "BAD_INPUT", "Only sandbox payments use this confirmation path.");
      if (order.paymentStatus === "paid") return ok({ alreadyPaid: true });
      await db.update(payments).set({ status: "paid", updatedAt: new Date(), verifiedBy: "sandbox-gateway" }).where(eq(payments.id, payment.id));
      await addOrderEvent(order.id, "payment_paid", "sandbox", `Sandbox payment ${payment.providerRef} verified`);
      await releaseOrderAfterPayment(order.shopId, order.id, "sandbox");
      await audit(order.shopId, "sandbox-gateway", "payment.verified", "order", order.id, `Sandbox payment ${payment.providerRef} confirmed`);
      return ok({ paid: true });
    }

    throw new ApiError(404, "NOT_FOUND", "Unknown payment action");
  } catch (err) {
    return errorResponse(err);
  }
}

// ---------- Cashfree webhook ----------
export async function PUT(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (action !== "webhook-cashfree") return errorResponse(new ApiError(404, "NOT_FOUND", "Unknown"));
  try {
    const raw = await req.text();
    const secret = process.env.CASHFREE_WEBHOOK_SECRET;
    if (secret) {
      const signature = req.headers.get("x-webhook-signature") ?? "";
      const expected = createHmac("sha256", secret).update(raw).digest("base64");
      const a = Buffer.from(signature);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ApiError(401, "BAD_SIGNATURE", "Invalid webhook signature");
    }
    const event = JSON.parse(raw || "{}");
    const cfOrderId = event?.data?.order?.order_id;
    if (!cfOrderId || !String(cfOrderId).startsWith("pf_")) return ok({ ignored: true });

    const orderRow = await db.select().from(orders).limit(5000);
    const order = orderRow.find((o) => `pf_${o.id.replace(/-/g, "").slice(0, 24)}` === cfOrderId);
    if (!order) return ok({ ignored: true, reason: "order not found" });
    if (order.paymentStatus === "paid") return ok({ alreadyPaid: true }); // idempotent

    // Verify with provider rather than trusting the event body alone.
    const verifyRes = await fetch(`${CASHFREE_BASE}/pg/orders/${cfOrderId}`, {
      headers: { "x-client-id": CASHFREE_ID ?? "", "x-client-secret": CASHFREE_SECRET ?? "", "x-api-version": "2022-09-01" },
    });
    const verify = await verifyRes.json().catch(() => null);
    const status = verify?.order_status;
    if (status === "PAID") {
      const existing = await db.select().from(payments).where(eq(payments.orderId, order.id)).limit(10);
      const pending = existing.find((p) => p.provider === "cashfree" && p.status === "pending");
      if (pending) await db.update(payments).set({ status: "paid", updatedAt: new Date(), verifiedBy: "cashfree-webhook" }).where(eq(payments.id, pending.id));
      await addOrderEvent(order.id, "payment_paid", "cashfree", `Cashfree order ${cfOrderId} verified PAID via webhook`);
      await releaseOrderAfterPayment(order.shopId, order.id, "cashfree");
      await audit(order.shopId, "cashfree-webhook", "payment.verified", "order", order.id, `Cashfree payment confirmed (${cfOrderId})`);
      return ok({ paid: true });
    }
    if (status === "FAILED" || status === "VOIDED") {
      await addOrderEvent(order.id, "payment_failed", "cashfree", `Cashfree status ${status}`);
      return ok({ failed: true });
    }
    return ok({ pending: true, status });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET() {
  return errorResponse(new ApiError(405, "METHOD_NOT_ALLOWED", "Use POST"));
}

// Silence unused import warning for shops while keeping import available for future reconciliation
void shops;
