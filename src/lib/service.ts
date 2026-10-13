import { and, eq, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  agents,
  auditLogs,
  documents,
  jobEvents,
  orderEvents,
  orderItems,
  orders,
  payments,
  pricingVersions,
  printJobs,
  printers,
  shops,
  staff,
} from "@/db/schema";
import { DEFAULT_RULES } from "./pricing";
import { pairingCode, randomToken } from "./utils";

export async function audit(
  shopId: string | null,
  actor: string,
  action: string,
  entityType?: string,
  entityId?: string,
  summary?: string,
) {
  await db.insert(auditLogs).values({
    shopId,
    actor,
    action,
    entityType: entityType ?? null,
    entityId: entityId ?? null,
    summary: summary ?? null,
  });
}

// ---------- shop creation with seed data ----------

export async function createShopWithSeed(ownerUserId: string, ownerEmail: string, input: { name: string; slug: string; description?: string }) {
  const [shop] = await db
    .insert(shops)
    .values({
      name: input.name,
      slug: input.slug.toLowerCase(),
      description: input.description ?? null,
      profile: {
        address: "",
        phone: "",
        hours: "Mon–Sat, 9:00 AM – 8:00 PM",
        instructions: "Orders are usually ready within 2 hours.",
        acceptOnlinePayments: true,
        acceptCounterPayments: true,
        openNow: true,
      },
    })
    .returning();

  await db.insert(staff).values({ shopId: shop.id, userId: ownerUserId, role: "owner" });

  await db.insert(pricingVersions).values({
    shopId: shop.id,
    version: 1,
    rules: DEFAULT_RULES,
    changedBy: ownerEmail,
  });

  const agentToken = `pfa_${randomToken(20)}`;
  const [agent] = await db
    .insert(agents)
    .values({
      shopId: shop.id,
      name: "Main counter PC",
      token: agentToken,
      version: "1.4.2",
      hostname: "COUNTER-PC",
      os: "Windows 11 Pro",
      testMode: true,
      pairingCode: pairingCode(),
      pairingCodeExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
    })
    .returning();

  await db.insert(printers).values([
    {
      shopId: shop.id,
      agentId: agent.id,
      name: "Microsoft Print to PDF (simulator)",
      isDefault: true,
      enabled: true,
      status: "online",
      capabilities: { sizes: ["A4", "A5", "Letter"], color: true, duplex: true },
      lastSeenAt: new Date(),
    },
    {
      shopId: shop.id,
      agentId: agent.id,
      name: "Shop LaserJet M407",
      isDefault: false,
      enabled: true,
      status: "online",
      capabilities: { sizes: ["A4", "A3", "Legal"], color: true, duplex: true },
      lastSeenAt: new Date(),
    },
  ]);

  await audit(shop.id, ownerEmail, "shop.created", "shop", shop.id, `Shop "${input.name}" created`);
  return shop;
}

// ---------- order state machine ----------

const ORDER_TRANSITIONS: Record<string, string[]> = {
  received: ["awaiting_payment", "waiting_approval", "queued", "cancelled", "rejected"],
  awaiting_payment: ["waiting_approval", "queued", "cancelled", "failed"],
  waiting_approval: ["queued", "cancelled", "rejected"],
  queued: ["printing", "paused", "cancelled"],
  printing: ["quality_check", "ready", "completed", "failed", "paused"],
  quality_check: ["ready", "completed", "printing"],
  ready: ["completed"],
  paused: ["queued", "cancelled"],
  completed: [],
  cancelled: [],
  rejected: [],
  failed: ["queued", "cancelled"],
};

export async function setOrderStatus(orderId: string, status: string, actor: string, note?: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) throw new Error("Order not found");
  const allowed = ORDER_TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(status)) {
    throw new Error(`Cannot move order from "${order.status}" to "${status}"`);
  }
  await db.update(orders).set({ status, updatedAt: new Date() }).where(eq(orders.id, orderId));
  await db.insert(orderEvents).values({ orderId, type: status, note: note ?? null, actor });
  return order;
}

export async function addOrderEvent(orderId: string, type: string, actor: string, note?: string) {
  await db.insert(orderEvents).values({ orderId, type, note: note ?? null, actor });
}

/** Recompute order status from its jobs (server-authoritative sync). */
export async function syncOrderFromJobs(orderId: string) {
  const jobs = await db.select().from(printJobs).where(eq(printJobs.orderId, orderId));
  if (jobs.length === 0) return;
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return;
  const statuses = jobs.map((j) => j.status);
  let next: string | null = null;
  if (statuses.some((s) => s === "printing")) next = "printing";
  else if (statuses.some((s) => s === "queued")) next = "queued";
  else if (statuses.some((s) => s === "paused")) next = "queued";
  else if (statuses.some((s) => s === "failed")) next = "failed";
  else if (statuses.every((s) => s === "completed")) {
    next = order.status === "completed" ? null : "ready";
  } else if (statuses.some((s) => s === "awaiting_payment")) next = "awaiting_payment";
  else if (statuses.some((s) => s === "waiting_approval")) next = "waiting_approval";
  if (next && next !== order.status) {
    await db.update(orders).set({ status: next, updatedAt: new Date() }).where(eq(orders.id, orderId));
    await db
      .insert(orderEvents)
      .values({ orderId, type: next, actor: "system", note: "Synced from print jobs" });
  }
}

/** After payment confirmation, release work according to operating mode. */
export async function releaseOrderAfterPayment(shopId: string, orderId: string, actor: string) {
  const [shop] = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
  if (!shop) return;
  await db.update(orders).set({ paymentStatus: "paid", updatedAt: new Date() }).where(eq(orders.id, orderId));
  const target = shop.operatingMode === "auto" ? "queued" : "waiting_approval";
  await db
    .update(printJobs)
    .set({ status: target, updatedAt: new Date() })
    .where(and(eq(printJobs.orderId, orderId), notInArray(printJobs.status, ["completed", "cancelled"])));
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (order && !["completed", "cancelled", "rejected"].includes(order.status)) {
    await db.update(orders).set({ status: target, updatedAt: new Date() }).where(eq(orders.id, orderId));
    await db
      .insert(orderEvents)
      .values({ orderId, type: target, actor, note: "Payment confirmed — released for printing" });
  }
}

export async function recordJobEvent(jobId: string, stage: string, source: string, detail?: string, eventId?: string) {
  if (eventId) {
    const existing = await db.select({ id: jobEvents.id }).from(jobEvents).where(eq(jobEvents.eventId, eventId)).limit(1);
    if (existing.length > 0) return false; // idempotent: duplicate event ignored
  }
  await db.insert(jobEvents).values({ jobId, stage, source, detail: detail ?? null, eventId: eventId ?? null });
  return true;
}

// ---------- Clear Memory (storage cleanup) ----------

const BLOCKING_JOB_STATUSES = ["awaiting_payment", "waiting_approval", "queued", "printing", "paused", "failed"];

export async function cleanupPreview(shopId: string) {
  const [shop] = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
  const retentionDays = shop?.retentionDays ?? 0;

  const docs = await db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      sizeBytes: documents.sizeBytes,
      orderId: documents.orderId,
      filesClearedAt: documents.filesClearedAt,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(and(eq(documents.shopId, shopId), isNull(documents.filesClearedAt), isNotNull(documents.orderId)));

  const eligible: typeof docs = [];
  const excluded: { fileName: string; reason: string }[] = [];

  for (const doc of docs) {
    if (!doc.orderId) {
      excluded.push({ fileName: doc.fileName, reason: "Not attached to an order" });
      continue;
    }
    const [order] = await db
      .select({ status: orders.status, paymentStatus: orders.paymentStatus, createdAt: orders.createdAt })
      .from(orders)
      .where(eq(orders.id, doc.orderId))
      .limit(1);
    if (!order) {
      excluded.push({ fileName: doc.fileName, reason: "Order record missing" });
      continue;
    }
    if (order.status !== "completed" && order.status !== "ready") {
      excluded.push({ fileName: doc.fileName, reason: `Order is ${order.status.replace(/_/g, " ")}` });
      continue;
    }
    const jobs = await db.select({ status: printJobs.status }).from(printJobs).where(eq(printJobs.documentId, doc.id));
    if (jobs.length === 0) {
      excluded.push({ fileName: doc.fileName, reason: "No print job history" });
      continue;
    }
    if (jobs.some((j) => BLOCKING_JOB_STATUSES.includes(j.status))) {
      excluded.push({ fileName: doc.fileName, reason: "Has active or unresolved print work" });
      continue;
    }
    if (!jobs.some((j) => j.status === "completed")) {
      excluded.push({ fileName: doc.fileName, reason: "No successfully completed print job" });
      continue;
    }
    if (retentionDays > 0) {
      const ageMs = Date.now() - new Date(order.createdAt).getTime();
      if (ageMs < retentionDays * 86400000) {
        excluded.push({ fileName: doc.fileName, reason: `Retention window (${retentionDays}d) not passed` });
        continue;
      }
    }
    eligible.push(doc);
  }

  const cleared = await db
    .select({ total: sql<number>`coalesce(sum(${documents.clearedBytes}), 0)::int` })
    .from(documents)
    .where(and(eq(documents.shopId, shopId), isNotNull(documents.filesClearedAt)));

  return {
    eligibleCount: eligible.length,
    eligibleBytes: eligible.reduce((s, d) => s + Number(d.sizeBytes || 0), 0),
    excludedCount: excluded.length,
    excludedSample: excluded.slice(0, 8),
    retentionDays,
    previouslyCleared: Number(cleared[0]?.total ?? 0),
    lastCleanupAt: shop?.lastCleanupAt ?? null,
  };
}

export async function cleanupRun(shopId: string, actor: string) {
  const preview = await cleanupPreview(shopId);
  const docs = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.shopId, shopId), isNull(documents.filesClearedAt), isNotNull(documents.orderId)));

  // Re-verify each candidate inside the execution pass (safe to retry / idempotent).
  let clearedCount = 0;
  let clearedBytes = 0;
  for (const d of docs) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, d.id)).limit(1);
    if (!doc || doc.filesClearedAt || !doc.orderId) continue;
    const [order] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, doc.orderId)).limit(1);
    if (!order || (order.status !== "completed" && order.status !== "ready")) continue;
    const jobs = await db.select({ status: printJobs.status }).from(printJobs).where(eq(printJobs.documentId, doc.id));
    if (jobs.length === 0 || !jobs.some((j) => j.status === "completed")) continue;
    if (jobs.some((j) => BLOCKING_JOB_STATUSES.includes(j.status))) continue;

    await db
      .update(documents)
      .set({ fileData: null, filesClearedAt: new Date(), clearedBytes: doc.sizeBytes, status: "cleared" })
      .where(and(eq(documents.id, doc.id), isNull(documents.filesClearedAt)));
    clearedCount++;
    clearedBytes += Number(doc.sizeBytes || 0);
  }

  if (clearedCount > 0) {
    await db.update(shops).set({ lastCleanupAt: new Date() }).where(eq(shops.id, shopId));
    await audit(shopId, actor, "storage.cleanup", "documents", shopId, `Cleared ${clearedCount} file(s), ~${clearedBytes} bytes (metadata preserved)`);
  }
  return { clearedCount, clearedBytes, eligibleAtRun: preview.eligibleCount };
}
