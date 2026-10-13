import { and, asc, count, desc, eq, gte, ilike, inArray, notInArray, or, sql } from "drizzle-orm";
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
  users,
} from "@/db/schema";
import { ApiError, errorResponse, ok, requireStaff, requireUser, STAFF_ROLES, type StaffRole } from "@/lib/auth";
import { getActivePricing } from "@/lib/pricing";
import { samplePdf, sha256 } from "@/lib/files";
import {
  addOrderEvent,
  audit,
  cleanupPreview,
  cleanupRun,
  createShopWithSeed,
  recordJobEvent,
  releaseOrderAfterPayment,
  setOrderStatus,
  syncOrderFromJobs,
} from "@/lib/service";
import { money, pairingCode, randomToken } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ area: string }> };

async function ctx(params: Promise<{ area: string }>) {
  const { area } = await params;
  return { area };
}

async function activeShopId(): Promise<string> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  const id = store.get("pf_shop")?.value;
  if (!id) throw new ApiError(400, "NO_SHOP", "Select or create a shop first.");
  return id;
}

// ============================== GET ==============================

export async function GET(_req: Request, { params }: Params) {
  try {
    const { area } = await ctx(params);
    const url = new URL(_req.url);
    const shopId = await activeShopId();
    const { user } = await requireStaffCtx(shopId);

    if (area === "stats") {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const [today] = await db
        .select({ n: count(), total: sql<number>`coalesce(sum(${orders.total}),0)::int` })
        .from(orders)
        .where(and(eq(orders.shopId, shopId), gte(orders.createdAt, dayStart), notInArray(orders.status, ["cancelled", "rejected"])));
      const jobs = await db.select({ status: printJobs.status }).from(printJobs).where(eq(printJobs.shopId, shopId));
      const queueCounts: Record<string, number> = {};
      for (const j of jobs) queueCounts[j.status] = (queueCounts[j.status] ?? 0) + 1;
      const pendingPayments = await db
        .select({ n: count() })
        .from(orders)
        .where(and(eq(orders.shopId, shopId), eq(orders.paymentStatus, "pending"), notInArray(orders.status, ["cancelled", "rejected", "completed"])));
      const agentRows = await db.select().from(agents).where(and(eq(agents.shopId, shopId), sql`${agents.revokedAt} is null`));
      const printerRows = await db.select().from(printers).where(eq(printers.shopId, shopId));
      const recent = await db.select().from(orders).where(eq(orders.shopId, shopId)).orderBy(desc(orders.createdAt)).limit(6);
      const revenue7d: { day: string; revenue: number; orders: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d0 = new Date();
        d0.setHours(0, 0, 0, 0);
        d0.setDate(d0.getDate() - i);
        const d1 = new Date(d0.getTime() + 86400000);
        const [row] = await db
          .select({ n: count(), total: sql<number>`coalesce(sum(${orders.total}),0)::int` })
          .from(orders)
          .where(and(eq(orders.shopId, shopId), gte(orders.createdAt, d0), sql`${orders.createdAt} < ${d1}`, inArray(orders.paymentStatus, ["paid"])));
        revenue7d.push({ day: d0.toLocaleDateString("en-IN", { weekday: "short" }), revenue: Number(row?.total ?? 0), orders: Number(row?.n ?? 0) });
      }
      const failedJobs = await db
        .select({ n: count() })
        .from(printJobs)
        .where(and(eq(printJobs.shopId, shopId), eq(printJobs.status, "failed")));
      const [shop] = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
      const alerts: { severity: "warning" | "danger" | "info"; message: string }[] = [];
      if (shop?.emergencyPaused) alerts.push({ severity: "danger", message: "Emergency pause is ON — agents cannot claim new jobs." });
      for (const a of agentRows) {
        const hb = a.lastHeartbeatAt ? Date.now() - new Date(a.lastHeartbeatAt).getTime() : Infinity;
        if (a.status === "never_connected") alerts.push({ severity: "info", message: `Agent "${a.name}" has never connected. Open Printers & Agent to start the simulator.` });
        else if (hb > 120000) alerts.push({ severity: "warning", message: `Agent "${a.name}" heartbeat is stale (offline).` });
      }
      if (Number(failedJobs[0]?.n ?? 0) > 0) alerts.push({ severity: "warning", message: `${failedJobs[0].n} failed print job(s) need attention.` });
      for (const p of printerRows) {
        if (p.status === "offline" && p.enabled) alerts.push({ severity: "warning", message: `Printer "${p.name}" is offline.` });
      }
      return ok({
        todayOrders: Number(today?.n ?? 0),
        todayRevenue: Number(today?.total ?? 0),
        pendingPayments: Number(pendingPayments[0]?.n ?? 0),
        queueCounts,
        failedJobs: Number(failedJobs[0]?.n ?? 0),
        agents: agentRows.map((a) => ({ id: a.id, name: a.name, status: a.status, lastHeartbeatAt: a.lastHeartbeatAt, testMode: a.testMode })),
        printers: printerRows.map((p) => ({ id: p.id, name: p.name, status: p.status, enabled: p.enabled, isDefault: p.isDefault })),
        recentOrders: recent.map((o) => ({ id: o.id, orderNumber: o.orderNumber, customerName: o.customerName, status: o.status, paymentStatus: o.paymentStatus, total: o.total, createdAt: o.createdAt })),
        revenue7d,
        alerts,
        shop: { id: shop.id, name: shop.name, operatingMode: shop.operatingMode, emergencyPaused: shop.emergencyPaused },
        currency: "INR",
      });
    }

    if (area === "orders") {
      const status = url.searchParams.get("status");
      const q = url.searchParams.get("q");
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
      const pageSize = 12;
      const conds = [eq(orders.shopId, shopId)];
      if (status && status !== "all") conds.push(eq(orders.status, status));
      if (q) conds.push(or(ilike(orders.orderNumber, `%${q}%`), ilike(orders.customerName, `%${q}%`), ilike(orders.phone ?? "", `%${q}%`))!);
      const where = and(...conds);
      const [totalRow] = await db.select({ n: count() }).from(orders).where(where);
      const rows = await db.select().from(orders).where(where).orderBy(desc(orders.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
      const items = rows.length > 0 ? await db.select().from(orderItems).where(inArray(orderItems.orderId, rows.map((r) => r.id))) : [];
      const jobs = rows.length > 0 ? await db.select({ id: printJobs.id, orderId: printJobs.orderId, status: printJobs.status }).from(printJobs).where(inArray(printJobs.orderId, rows.map((r) => r.id))) : [];
      return ok({
        page,
        pageSize,
        total: Number(totalRow?.n ?? 0),
        orders: rows.map((o) => ({
          ...o,
          itemCount: items.filter((i) => i.orderId === o.id).length,
          jobStatuses: jobs.filter((j) => j.orderId === o.id).map((j) => j.status),
        })),
      });
    }

    if (area === "order") {
      const id = url.searchParams.get("id");
      if (!id) throw new ApiError(400, "BAD_INPUT", "Missing order id");
      const [order] = await db.select().from(orders).where(and(eq(orders.id, id), eq(orders.shopId, shopId))).limit(1);
      if (!order) throw new ApiError(404, "NOT_FOUND", "Order not found");
      const [its, pays, jobs, evts, docs] = await Promise.all([
        db.select().from(orderItems).where(eq(orderItems.orderId, id)),
        db.select().from(payments).where(eq(payments.orderId, id)).orderBy(desc(payments.createdAt)),
        db.select().from(printJobs).where(eq(printJobs.orderId, id)),
        db.select().from(orderEvents).where(eq(orderEvents.orderId, id)).orderBy(asc(orderEvents.createdAt)),
        db.select({ id: documents.id, fileName: documents.fileName, filesClearedAt: documents.filesClearedAt, status: documents.status }).from(documents).where(eq(documents.orderId, id)),
      ]);
      const jobEvts = jobs.length > 0 ? await db.select().from(jobEvents).where(inArray(jobEvents.jobId, jobs.map((j) => j.id))).orderBy(asc(jobEvents.createdAt)) : [];
      return ok({ order, items: its, payments: pays, jobs, events: evts, documents: docs, jobEvents: jobEvts });
    }

    if (area === "jobs") {
      const status = url.searchParams.get("status");
      const conds = [eq(printJobs.shopId, shopId)];
      if (status && status !== "all") {
        if (status === "attention") conds.push(inArray(printJobs.status, ["failed", "paused"]));
        else conds.push(eq(printJobs.status, status));
      }
      const rows = await db.select().from(printJobs).where(and(...conds)).orderBy(asc(printJobs.priority), desc(printJobs.createdAt)).limit(200);
      const orderIds = [...new Set(rows.map((r) => r.orderId).filter(Boolean))] as string[];
      const printerIds = [...new Set(rows.map((r) => r.printerId).filter(Boolean))] as string[];
      const docIds = [...new Set(rows.map((r) => r.documentId).filter(Boolean))] as string[];
      const [ordRows, printerRows, docRows] = await Promise.all([
        orderIds.length ? db.select({ id: orders.id, orderNumber: orders.orderNumber, customerName: orders.customerName }).from(orders).where(inArray(orders.id, orderIds)) : Promise.resolve([]),
        printerIds.length ? db.select({ id: printers.id, name: printers.name }).from(printers).where(inArray(printers.id, printerIds)) : Promise.resolve([]),
        docIds.length ? db.select({ id: documents.id, fileName: documents.fileName, filesClearedAt: documents.filesClearedAt }).from(documents).where(inArray(documents.id, docIds)) : Promise.resolve([]),
      ]);
      return ok({
        jobs: rows.map((j) => ({
          ...j,
          orderNumber: ordRows.find((o) => o.id === j.orderId)?.orderNumber ?? (j.kind === "test" ? "TEST" : "—"),
          customerName: ordRows.find((o) => o.id === j.orderId)?.customerName ?? "Test print",
          printerName: printerRows.find((p) => p.id === j.printerId)?.name ?? null,
          fileName: docRows.find((d) => d.id === j.documentId)?.fileName ?? (j.kind === "test" ? "Test page (built-in PDF)" : null),
          fileCleared: docRows.find((d) => d.id === j.documentId)?.filesClearedAt ? true : false,
        })),
      });
    }

    if (area === "payments") {
      const rows = await db.select().from(payments).where(eq(payments.shopId, shopId)).orderBy(desc(payments.createdAt)).limit(200);
      const orderRows = rows.length > 0 ? await db.select({ id: orders.id, orderNumber: orders.orderNumber }).from(orders).where(inArray(orders.id, rows.map((r) => r.orderId))) : [];
      return ok({ payments: rows.map((p) => ({ ...p, orderNumber: orderRows.find((o) => o.id === p.orderId)?.orderNumber ?? "—" })) });
    }

    if (area === "pricing") {
      const { rules, version } = await getActivePricing(shopId);
      const history = await db
        .select({ version: pricingVersions.version, changedBy: pricingVersions.changedBy, createdAt: pricingVersions.createdAt })
        .from(pricingVersions)
        .where(eq(pricingVersions.shopId, shopId))
        .orderBy(desc(pricingVersions.version))
        .limit(10);
      return ok({ rules, version, history });
    }

    if (area === "settings") {
      const [shop] = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
      if (!shop) throw new ApiError(404, "NOT_FOUND", "Shop not found");
      return ok({
        shop: {
          id: shop.id,
          name: shop.name,
          slug: shop.slug,
          description: shop.description,
          accent: shop.accent,
          profile: shop.profile,
          operatingMode: shop.operatingMode,
          emergencyPaused: shop.emergencyPaused,
          retentionDays: shop.retentionDays,
          lastCleanupAt: shop.lastCleanupAt,
          orderSeq: shop.orderSeq,
        },
        publicUrl: `/s/${shop.slug}`,
      });
    }

    if (area === "agents") {
      const rows = await db.select().from(agents).where(eq(agents.shopId, shopId)).orderBy(asc(agents.createdAt));
      return ok({
        agents: rows.map((a) => ({ ...a, tokenMasked: `${a.token.slice(0, 12)}…${a.token.slice(-4)}` })),
        pairExample: "curl -X POST <your-domain>/api/agent/pair -H 'Content-Type: application/json' -d '{\"code\":\"XXXX-XXXX\"}'",
      });
    }

    if (area === "printers") {
      const rows = await db.select().from(printers).where(eq(printers.shopId, shopId)).orderBy(asc(printers.createdAt));
      return ok({ printers: rows });
    }

    if (area === "staff") {
      const rows = await db.select().from(staff).where(eq(staff.shopId, shopId));
      const userIds = rows.map((r) => r.userId);
      const userRows = userIds.length ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, userIds)) : [];
      return ok({
        staff: rows.map((s) => ({
          id: s.id,
          role: s.role,
          active: s.active,
          createdAt: s.createdAt,
          name: userRows.find((u) => u.id === s.userId)?.name ?? "Unknown",
          email: userRows.find((u) => u.id === s.userId)?.email ?? "",
        })),
        roles: STAFF_ROLES,
      });
    }

    if (area === "audit") {
      const rows = await db.select().from(auditLogs).where(eq(auditLogs.shopId, shopId)).orderBy(desc(auditLogs.createdAt)).limit(100);
      return ok({ entries: rows });
    }

    if (area === "cleanup") {
      const preview = await cleanupPreview(shopId);
      return ok({ preview });
    }

    if (area === "job-events") {
      const jobId = url.searchParams.get("jobId");
      const rows = jobId ? await db.select().from(jobEvents).where(eq(jobEvents.jobId, jobId)).orderBy(asc(jobEvents.createdAt)) : [];
      return ok({ events: rows });
    }

    throw new ApiError(404, "NOT_FOUND", `Unknown area: ${area}`);
  } catch (err) {
    return errorResponse(err);
  }
}

async function requireStaffCtx(shopId: string, minRoles?: StaffRole[]) {
  return requireStaff(shopId, minRoles);
}

// ============================== POST ==============================

export async function POST(req: Request, { params }: Params) {
  try {
    const { area } = await ctx(params);
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));

    if (area === "shops") {
      const name = String(body?.name ?? "").trim();
      let slug = String(body?.slug ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      if (name.length < 2) throw new ApiError(400, "BAD_INPUT", "Shop name is required.");
      if (!slug) slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-");
      const existing = await db.select({ id: shops.id }).from(shops).where(eq(shops.slug, slug)).limit(1);
      if (existing.length > 0) slug = `${slug}-${Math.floor(1000 + Math.random() * 9000)}`;
      const shop = await createShopWithSeed(user.id, user.email, { name, slug, description: body?.description });
      return ok({ shop: { id: shop.id, name: shop.name, slug: shop.slug } });
    }

    const shopId = await activeShopId();
    const { role } = await requireStaffCtx(shopId);

    if (area === "orders") {
      const id = String(body?.id ?? "");
      const action = String(body?.action ?? "");
      const [order] = await db.select().from(orders).where(and(eq(orders.id, id), eq(orders.shopId, shopId))).limit(1);
      if (!order) throw new ApiError(404, "NOT_FOUND", "Order not found");

      if (action === "approve") {
        if (order.paymentStatus !== "paid") throw new ApiError(409, "UNPAID", "This order is not paid yet. Record or verify payment first.");
        await setOrderStatus(id, "queued", user.email, "Approved and released to print queue");
        await db.update(printJobs).set({ status: "queued", updatedAt: new Date() }).where(and(eq(printJobs.orderId, id), eq(printJobs.status, "waiting_approval")));
        await audit(shopId, user.email, "order.approved", "order", id, `Order ${order.orderNumber} released to queue`);
        return ok({ status: "queued" });
      }
      if (action === "cancel") {
        await setOrderStatus(id, "cancelled", user.email, String(body?.reason ?? "Cancelled by staff"));
        await db.update(printJobs).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(printJobs.orderId, id), notInArray(printJobs.status, ["completed", "printing"])));
        await audit(shopId, user.email, "order.cancelled", "order", id, `Order ${order.orderNumber} cancelled`);
        return ok({ status: "cancelled" });
      }
      if (action === "ready") {
        await setOrderStatus(id, "ready", user.email);
        return ok({ status: "ready" });
      }
      if (action === "complete") {
        const current = order.status;
        if (current === "quality_check" || current === "printing") await setOrderStatus(id, "ready", user.email);
        await setOrderStatus(id, "completed", user.email);
        await audit(shopId, user.email, "order.completed", "order", id, `Order ${order.orderNumber} marked completed`);
        return ok({ status: "completed" });
      }
      if (action === "reject") {
        await setOrderStatus(id, "rejected", user.email, String(body?.reason ?? "Rejected by shop"));
        await audit(shopId, user.email, "order.rejected", "order", id, `Order ${order.orderNumber} rejected`);
        return ok({ status: "rejected" });
      }
      if (action === "note") {
        await db.update(orders).set({ note: String(body?.note ?? ""), updatedAt: new Date() }).where(eq(orders.id, id));
        return ok({});
      }
      throw new ApiError(400, "BAD_INPUT", `Unknown order action: ${action}`);
    }

    if (area === "payments") {
      const orderId = String(body?.orderId ?? "");
      const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.shopId, shopId))).limit(1);
      if (!order) throw new ApiError(404, "NOT_FOUND", "Order not found");
      if (order.paymentStatus === "paid") throw new ApiError(409, "ALREADY_PAID", "This order is already paid.");
      const method = String(body?.method ?? "cash");
      const amount = Number(body?.amount ?? order.total);
      await db.insert(payments).values({
        shopId,
        orderId,
        provider: "counter",
        method,
        amount,
        currency: order.currency,
        status: "paid",
        verifiedBy: user.email,
        note: String(body?.note ?? ""),
      });
      await addOrderEvent(order.id, "payment_recorded", user.email, `${method} payment of ${money(amount, order.currency)} recorded at counter`);
      await releaseOrderAfterPayment(shopId, order.id, user.email);
      await audit(shopId, user.email, "payment.recorded", "order", order.id, `Counter payment ${money(amount, order.currency)} for ${order.orderNumber}`);
      return ok({ paid: true });
    }

    if (area === "pricing") {
      if (!["owner", "manager"].includes(role)) throw new ApiError(403, "FORBIDDEN", "Only owners/managers can change pricing.");
      const rules = body?.rules;
      if (!rules || typeof rules !== "object") throw new ApiError(400, "BAD_INPUT", "Missing pricing rules");
      const [latest] = await db.select().from(pricingVersions).where(eq(pricingVersions.shopId, shopId)).orderBy(desc(pricingVersions.version)).limit(1);
      const nextVersion = (latest?.version ?? 0) + 1;
      await db.insert(pricingVersions).values({ shopId, version: nextVersion, rules, changedBy: user.email });
      await audit(shopId, user.email, "pricing.published", "pricing", String(nextVersion), `Pricing version ${nextVersion} published`);
      return ok({ version: nextVersion });
    }

    if (area === "settings") {
      if (!["owner", "manager"].includes(role)) throw new ApiError(403, "FORBIDDEN", "Only owners/managers can change shop settings.");
      const patch: Record<string, unknown> = {};
      const [shop] = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
      if (!shop) throw new ApiError(404, "NOT_FOUND", "Shop not found");
      const p = body?.profile;
      if (p && typeof p === "object") patch.profile = { ...(shop.profile as object), ...(p as object) };
      if (typeof body?.name === "string" && body.name.trim()) patch.name = body.name.trim();
      if (typeof body?.description === "string") patch.description = body.description;
      if (typeof body?.retentionDays === "number") patch.retentionDays = Math.max(0, Math.min(365, body.retentionDays));
      if (["manual", "auto", "hybrid"].includes(body?.operatingMode)) {
        patch.operatingMode = body.operatingMode;
        await audit(shopId, user.email, "settings.mode", "shop", shopId, `Operating mode → ${body.operatingMode}`);
      }
      if (typeof body?.emergencyPaused === "boolean") {
        patch.emergencyPaused = body.emergencyPaused;
        await audit(shopId, user.email, body.emergencyPaused ? "pause.engaged" : "pause.released", "shop", shopId, body.emergencyPaused ? "Emergency pause engaged" : "Emergency pause released");
      }
      if (Object.keys(patch).length === 0) throw new ApiError(400, "BAD_INPUT", "No valid settings provided");
      await db.update(shops).set(patch).where(eq(shops.id, shopId));
      return ok({ saved: true });
    }

    if (area === "agents") {
      if (!["owner", "manager"].includes(role)) throw new ApiError(403, "FORBIDDEN", "Only owners/managers can manage agents.");
      const action = String(body?.action ?? "");
      const agentId = String(body?.id ?? "");
      const [agent] = await db.select().from(agents).where(and(eq(agents.id, agentId), eq(agents.shopId, shopId))).limit(1);

      if (action === "create") {
        const name = String(body?.name ?? "New agent").trim() || "New agent";
        const token = `pfa_${randomToken(20)}`;
        const [created] = await db
          .insert(agents)
          .values({ shopId, name, token, testMode: true, pairingCode: pairingCode(), pairingCodeExpiresAt: new Date(Date.now() + 30 * 60000) })
          .returning();
        await audit(shopId, user.email, "agent.created", "agent", created.id, `Agent "${name}" created`);
        return ok({ agent: { id: created.id, name: created.name, token: created.token } });
      }

      if (!agent) throw new ApiError(404, "NOT_FOUND", "Agent not found");
      if (action === "pairing-code") {
        const code = pairingCode();
        await db.update(agents).set({ pairingCode: code, pairingCodeExpiresAt: new Date(Date.now() + 30 * 60000) }).where(eq(agents.id, agent.id));
        await audit(shopId, user.email, "agent.pairing_code", "agent", agent.id, `New pairing code issued for ${agent.name}`);
        return ok({ pairingCode: code, expiresMinutes: 30 });
      }
      if (action === "rotate-token") {
        const token = `pfa_${randomToken(20)}`;
        await db.update(agents).set({ token }).where(eq(agents.id, agent.id));
        await audit(shopId, user.email, "agent.token_rotated", "agent", agent.id, `Token rotated for ${agent.name}`);
        return ok({ token });
      }
      if (action === "toggle-test") {
        await db.update(agents).set({ testMode: !agent.testMode }).where(eq(agents.id, agent.id));
        await audit(shopId, user.email, "agent.test_mode", "agent", agent.id, `Test mode ${!agent.testMode ? "enabled" : "disabled"} for ${agent.name}`);
        return ok({ testMode: !agent.testMode });
      }
      if (action === "revoke") {
        await db.update(agents).set({ revokedAt: new Date(), status: "revoked" }).where(eq(agents.id, agent.id));
        await db.update(printJobs).set({ status: "queued", agentId: null, leaseExpiresAt: null }).where(and(eq(printJobs.agentId, agent.id), inArray(printJobs.status, ["printing"])));
        await audit(shopId, user.email, "agent.revoked", "agent", agent.id, `Agent ${agent.name} revoked`);
        return ok({});
      }
      if (action === "reactivate") {
        await db.update(agents).set({ revokedAt: null, status: "never_connected" }).where(eq(agents.id, agent.id));
        return ok({});
      }
      if (action === "toggle-pause") {
        await db.update(agents).set({ paused: !agent.paused }).where(eq(agents.id, agent.id));
        await audit(shopId, user.email, agent.paused ? "agent.resumed" : "agent.paused", "agent", agent.id, `Agent ${agent.name} ${agent.paused ? "resumed" : "paused"}`);
        return ok({ paused: !agent.paused });
      }
      throw new ApiError(400, "BAD_INPUT", `Unknown agent action: ${action}`);
    }

    if (area === "printers") {
      const action = String(body?.action ?? "");
      const printerId = String(body?.id ?? "");
      const [printer] = await db.select().from(printers).where(and(eq(printers.id, printerId), eq(printers.shopId, shopId))).limit(1);
      if (!printer) throw new ApiError(404, "NOT_FOUND", "Printer not found");
      if (action === "default") {
        await db.update(printers).set({ isDefault: false }).where(eq(printers.shopId, shopId));
        await db.update(printers).set({ isDefault: true }).where(eq(printers.id, printer.id));
        return ok({});
      }
      if (action === "toggle-enabled") {
        await db.update(printers).set({ enabled: !printer.enabled, status: !printer.enabled ? "online" : "disabled" }).where(eq(printers.id, printer.id));
        return ok({ enabled: !printer.enabled });
      }
      if (action === "mark-status") {
        const status = String(body?.status ?? "online");
        if (!["online", "offline", "attention", "busy"].includes(status)) throw new ApiError(400, "BAD_INPUT", "Invalid printer status");
        await db.update(printers).set({ status }).where(eq(printers.id, printer.id));
        return ok({ status });
      }
      if (action === "test-print") {
        const pdf = samplePdf(`Printer test — ${printer.name}`);
        const [doc] = await db
          .insert(documents)
          .values({ shopId, orderId: null, fileName: "printer-test.pdf", mime: "application/pdf", ext: "pdf", kind: "pdf", sizeBytes: pdf.length, checksum: sha256(pdf), pageCount: 1, fileData: pdf, status: "ready", createdBy: user.id })
          .returning();
        const [job] = await db
          .insert(printJobs)
          .values({ shopId, orderId: null, itemId: null, documentId: doc.id, label: `Test print → ${printer.name}`, kind: "test", status: "queued", printerId: printer.id, priority: 1, testMode: true, configSnapshot: { copies: 1, colorMode: "bw", paperSize: "A4", duplex: "off", pagesPerSheet: 1, pageRange: "all", orientation: "portrait" } })
          .returning();
        await recordJobEvent(job.id, "created", user.email, "Test print requested from admin");
        await db.update(printers).set({ lastTestAt: new Date() }).where(eq(printers.id, printer.id));
        return ok({ jobId: job.id });
      }
      throw new ApiError(400, "BAD_INPUT", `Unknown printer action: ${action}`);
    }

    if (area === "staff") {
      if (!["owner", "manager"].includes(role)) throw new ApiError(403, "FORBIDDEN", "Only owners/managers can manage staff.");
      const action = String(body?.action ?? "add");
      if (action === "add") {
        const email = String(body?.email ?? "").trim().toLowerCase();
        const newRole = String(body?.role ?? "counter");
        if (!STAFF_ROLES.includes(newRole as StaffRole)) throw new ApiError(400, "BAD_INPUT", "Invalid role");
        const [target] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!target) throw new ApiError(404, "NO_USER", "No account exists with that email. Ask them to register first, then add them here.");
        const existing = await db.select().from(staff).where(and(eq(staff.shopId, shopId), eq(staff.userId, target.id))).limit(1);
        if (existing.length > 0) throw new ApiError(409, "EXISTS", "That user is already on this shop's staff.");
        await db.insert(staff).values({ shopId, userId: target.id, role: newRole });
        await audit(shopId, user.email, "staff.added", "staff", target.id, `${target.email} added as ${newRole}`);
        return ok({});
      }
      const membershipId = String(body?.id ?? "");
      const [membership] = await db.select().from(staff).where(and(eq(staff.id, membershipId), eq(staff.shopId, shopId))).limit(1);
      if (!membership) throw new ApiError(404, "NOT_FOUND", "Staff member not found");
      if (membership.role === "owner" && action !== "role") throw new ApiError(403, "FORBIDDEN", "The shop owner cannot be disabled.");
      if (action === "disable") {
        await db.update(staff).set({ active: false }).where(eq(staff.id, membership.id));
        await audit(shopId, user.email, "staff.disabled", "staff", membership.id, "Staff access disabled");
        return ok({});
      }
      if (action === "enable") {
        await db.update(staff).set({ active: true }).where(eq(staff.id, membership.id));
        return ok({});
      }
      if (action === "role") {
        const newRole = String(body?.role ?? "");
        if (!STAFF_ROLES.includes(newRole as StaffRole)) throw new ApiError(400, "BAD_INPUT", "Invalid role");
        if (membership.role === "owner") throw new ApiError(403, "FORBIDDEN", "Cannot change the owner's role.");
        await db.update(staff).set({ role: newRole }).where(eq(staff.id, membership.id));
        await audit(shopId, user.email, "staff.role_changed", "staff", membership.id, `Role → ${newRole}`);
        return ok({});
      }
      throw new ApiError(400, "BAD_INPUT", "Unknown staff action");
    }

    if (area === "cleanup") {
      if (!["owner", "manager"].includes(role)) throw new ApiError(403, "FORBIDDEN", "Only owners/managers can run storage cleanup.");
      if (body?.confirm !== true) throw new ApiError(400, "CONFIRM_REQUIRED", "Cleanup requires explicit confirmation.");
      const result = await cleanupRun(shopId, user.email);
      return ok(result);
    }

    if (area === "jobs") {
      const action = String(body?.action ?? "");
      const jobId = String(body?.jobId ?? "");
      const [job] = await db.select().from(printJobs).where(and(eq(printJobs.id, jobId), eq(printJobs.shopId, shopId))).limit(1);
      if (!job) throw new ApiError(404, "NOT_FOUND", "Job not found");

      if (action === "pause" && job.status === "queued") {
        await db.update(printJobs).set({ status: "paused", updatedAt: new Date() }).where(eq(printJobs.id, job.id));
        await recordJobEvent(job.id, "paused", user.email, "Paused by staff");
        if (job.orderId) await addOrderEvent(job.orderId, "job_paused", user.email);
        return ok({});
      }
      if (action === "resume" && job.status === "paused") {
        await db.update(printJobs).set({ status: "queued", updatedAt: new Date() }).where(eq(printJobs.id, job.id));
        await recordJobEvent(job.id, "resumed", user.email, "Resumed by staff");
        return ok({});
      }
      if (action === "retry" && ["failed"].includes(job.status)) {
        await db.update(printJobs).set({ status: "queued", attempts: job.attempts + 1, errorReason: null, agentId: null, leaseExpiresAt: null, updatedAt: new Date() }).where(eq(printJobs.id, job.id));
        await recordJobEvent(job.id, "retry", user.email, `Retry #${job.attempts + 1} requested by staff`);
        await audit(shopId, user.email, "job.retry", "job", job.id, "Failed job retried");
        return ok({});
      }
      if (action === "cancel" && !["completed", "cancelled"].includes(job.status)) {
        await db.update(printJobs).set({ status: "cancelled", updatedAt: new Date() }).where(eq(printJobs.id, job.id));
        await recordJobEvent(job.id, "cancelled", user.email, "Cancelled by staff");
        if (job.orderId) await addOrderEvent(job.orderId, "job_cancelled", user.email);
        return ok({});
      }
      if (action === "priority") {
        const priority = Math.max(1, Math.min(5, Number(body?.priority ?? 3)));
        await db.update(printJobs).set({ priority }).where(eq(printJobs.id, job.id));
        return ok({});
      }
      if (action === "assign") {
        const printerId = String(body?.printerId ?? "");
        const [p] = await db.select().from(printers).where(and(eq(printers.id, printerId), eq(printers.shopId, shopId))).limit(1);
        if (!p) throw new ApiError(404, "NOT_FOUND", "Printer not found");
        await db.update(printJobs).set({ printerId: p.id }).where(eq(printJobs.id, job.id));
        await recordJobEvent(job.id, "assigned", user.email, `Assigned to printer ${p.name}`);
        return ok({});
      }
      if (action === "reprint") {
        if (!["owner", "manager", "operator"].includes(role)) throw new ApiError(403, "FORBIDDEN", "Your role cannot reprint jobs.");
        if (job.status !== "completed") throw new ApiError(409, "INVALID_STATE", "Only completed jobs can be reprinted.");
        const reason = String(body?.reason ?? "").trim();
        if (!reason) throw new ApiError(400, "REASON_REQUIRED", "A reprint reason is required.");
        const [doc] = job.documentId ? await db.select({ filesClearedAt: documents.filesClearedAt }).from(documents).where(eq(documents.id, job.documentId)).limit(1) : [{ filesClearedAt: null }];
        if (doc?.filesClearedAt) throw new ApiError(409, "FILE_CLEARED", "The source file was securely cleared and can no longer be reprinted.");
        const [newJob] = await db
          .insert(printJobs)
          .values({ shopId, orderId: job.orderId, itemId: job.itemId, documentId: job.documentId, label: `${job.label} (reprint)`, kind: job.kind, status: "queued", printerId: job.printerId, priority: 2, testMode: job.testMode, configSnapshot: job.configSnapshot })
          .returning();
        await recordJobEvent(newJob.id, "created", user.email, `Reprint of job ${job.id.slice(0, 8)} — reason: ${reason}`);
        await audit(shopId, user.email, "job.reprint", "job", newJob.id, `Reprint requested. Reason: ${reason}`);
        return ok({ jobId: newJob.id });
      }
      throw new ApiError(400, "BAD_INPUT", `Action "${action}" not allowed from state "${job.status}"`);
    }

    throw new ApiError(404, "NOT_FOUND", `Unknown area: ${area}`);
  } catch (err) {
    return errorResponse(err);
  }
}

// ============================== PATCH (legacy agent contract) ==============================
// Preserved compatibility contract: PATCH /api/admin/jobs with { id, status } lets simple
// integrations move a claimed job to a terminal state. Production agents should use /api/agent/*.

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { area } = await params;
    if (area !== "jobs") throw new ApiError(404, "NOT_FOUND", "PATCH only supported on jobs");
    const shopId = await activeShopId();
    const { user } = await requireStaffCtx(shopId);
    const body = await req.json().catch(() => ({}));
    const jobId = String(body?.id ?? body?.jobId ?? "");
    const status = String(body?.status ?? "");
    if (!jobId) throw new ApiError(400, "BAD_INPUT", "Missing job id");
    if (!["printing", "completed", "failed"].includes(status)) throw new ApiError(400, "BAD_INPUT", "Status must be printing, completed or failed");

    const [job] = await db.select().from(printJobs).where(and(eq(printJobs.id, jobId), eq(printJobs.shopId, shopId))).limit(1);
    if (!job) throw new ApiError(404, "NOT_FOUND", "Job not found");
    if (["completed", "cancelled"].includes(job.status)) return ok({ alreadyTerminal: true });

    if (status === "printing") {
      await db.update(printJobs).set({ status: "printing", progressStage: "claimed", updatedAt: new Date(), startedAt: job.startedAt ?? new Date() }).where(eq(printJobs.id, jobId));
      await recordJobEvent(jobId, "printing", user.email, "Marked printing via legacy contract");
    } else if (status === "completed") {
      await db.update(printJobs).set({ status: "completed", progressStage: "completed", completedAt: new Date(), leaseExpiresAt: null, updatedAt: new Date() }).where(eq(printJobs.id, jobId));
      await recordJobEvent(jobId, "completed", user.email, "Marked completed via legacy contract");
      if (job.orderId) await syncOrderFromJobs(job.orderId);
    } else {
      await db.update(printJobs).set({ status: "failed", progressStage: "failed", errorReason: String(body?.reason ?? "Marked failed via legacy contract"), leaseExpiresAt: null, updatedAt: new Date() }).where(eq(printJobs.id, jobId));
      await recordJobEvent(jobId, "failed", user.email, String(body?.reason ?? "Marked failed via legacy contract"));
      if (job.orderId) await syncOrderFromJobs(job.orderId);
    }
    return ok({ status });
  } catch (err) {
    return errorResponse(err);
  }
}
