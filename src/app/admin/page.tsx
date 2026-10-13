import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, gte, inArray, notInArray, sql, count } from "drizzle-orm";
import { db } from "@/db";
import { agents, orders, printJobs, printers, shops } from "@/db/schema";
import { getAdminContext } from "@/lib/admin-context";
import { Badge, Icon, StatusDot } from "@/components/ui";
import { CreateShopCard } from "@/components/create-shop";
import { formatDate, money, ORDER_STATUS, PRINTER_STATUS, timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const ctx = await getAdminContext();
  if (!ctx.user) notFound();
  if (!ctx.activeShop) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold">Welcome to PrintFlow 👋</h1>
        <p className="text-muted mt-1 mb-6">Create your first shop to start receiving print orders.</p>
        <CreateShopCard />
      </div>
    );
  }
  const shopId = ctx.activeShop.id;
  const [shop] = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const [today] = await db
    .select({ n: count(), total: sql<number>`coalesce(sum(${orders.total}),0)::int` })
    .from(orders)
    .where(and(eq(orders.shopId, shopId), gte(orders.createdAt, dayStart), notInArray(orders.status, ["cancelled", "rejected"])));
  const [pendingPay] = await db
    .select({ n: count() })
    .from(orders)
    .where(and(eq(orders.shopId, shopId), eq(orders.paymentStatus, "pending"), notInArray(orders.status, ["cancelled", "rejected", "completed"])));

  const jobs = await db.select({ status: printJobs.status }).from(printJobs).where(eq(printJobs.shopId, shopId));
  const qc: Record<string, number> = {};
  for (const j of jobs) qc[j.status] = (qc[j.status] ?? 0) + 1;

  const [shopAgents, shopPrinters, recentOrders] = await Promise.all([
    db.select().from(agents).where(eq(agents.shopId, shopId)),
    db.select().from(printers).where(eq(printers.shopId, shopId)),
    db.select().from(orders).where(eq(orders.shopId, shopId)).orderBy(desc(orders.createdAt)).limit(7),
  ]);

  const revenue7d: { day: string; value: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d0 = new Date();
    d0.setHours(0, 0, 0, 0);
    d0.setDate(d0.getDate() - i);
    const d1 = new Date(d0.getTime() + 86400000);
    const [row] = await db
      .select({ total: sql<number>`coalesce(sum(${orders.total}),0)::int` })
      .from(orders)
      .where(and(eq(orders.shopId, shopId), gte(orders.createdAt, d0), sql`${orders.createdAt} < ${d1}`, eq(orders.paymentStatus, "paid")));
    revenue7d.push({ day: d0.toLocaleDateString("en-IN", { weekday: "short" }), value: Number(row?.total ?? 0) });
  }
  const maxRev = Math.max(1, ...revenue7d.map((r) => r.value));

  const liveAgents = shopAgents.filter((a) => !a.revokedAt);
  const activeJobCount = (qc.queued ?? 0) + (qc.printing ?? 0) + (qc.waiting_approval ?? 0) + (qc.awaiting_payment ?? 0);
  const maxBar = Math.max(1, qc.completed ?? 0, qc.queued ?? 0, qc.printing ?? 0, qc.failed ?? 0, qc.awaiting_payment ?? 0, qc.waiting_approval ?? 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted text-sm mt-0.5">{shop.name} · {formatDate(new Date())}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={shop.operatingMode === "auto" ? "teal" : shop.operatingMode === "hybrid" ? "info" : "neutral"} className="capitalize">{shop.operatingMode} mode</Badge>
          {shop.emergencyPaused ? <Badge tone="danger">Emergency pause ON</Badge> : <Badge tone="success">Accepting work</Badge>}
          <Link href={`/s/${shop.slug}/new`} target="_blank" className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-[var(--radius-control)] bg-accent text-onaccent text-[13px] font-bold hover:bg-accent-hover transition-colors">
            <Icon name="external" size={14} /> Customer view
          </Link>
        </div>
      </div>

      {/* KPI bento row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Orders today", value: String(today?.n ?? 0), icon: "orders", href: "/admin/orders" },
          { label: "Revenue today", value: money(Number(today?.total ?? 0)), icon: "chart", href: "/admin/analytics" },
          { label: "Pending payments", value: String(pendingPay?.n ?? 0), icon: "card", href: "/admin/payments" },
          { label: "Active jobs", value: String(activeJobCount), icon: "queue", href: "/admin/queue" },
        ].map((k) => (
          <Link key={k.label} href={k.href} className="card p-4 hover:border-accent/50 transition-colors">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-muted">{k.label}</span>
              <Icon name={k.icon} size={16} className="text-faint" />
            </div>
            <p className="font-display text-2xl font-bold mt-2 tabular-nums">{k.value}</p>
          </Link>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Queue overview — wide */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-bold">Print queue overview</h2>
            <Link href="/admin/queue" className="text-[13px] font-semibold text-accent inline-flex items-center gap-1 hover:underline">Open queue <Icon name="arrowRight" size={13} /></Link>
          </div>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted py-6 text-center">No print jobs yet. Share your QR code to receive the first order.</p>
          ) : (
            <div className="space-y-2.5">
              {(["awaiting_payment", "waiting_approval", "queued", "printing", "completed", "failed", "paused", "cancelled"] as const).map((s) => {
                const n = qc[s] ?? 0;
                if (n === 0) return null;
                const meta = ORDER_STATUS[s] ?? { label: s, tone: "neutral" as const };
                return (
                  <Link key={s} href={`/admin/queue?status=${s}`} className="flex items-center gap-3 group">
                    <span className="w-32 text-[12.5px] font-semibold text-muted shrink-0">{meta.label}</span>
                    <span className="flex-1 h-5 rounded-md bg-[var(--track)] overflow-hidden">
                      <span className={`block h-full rounded-md ${s === "completed" ? "bg-emerald-500/70" : s === "failed" || s === "cancelled" ? "bg-red-500/70" : s === "printing" || s === "queued" ? "bg-accent/80" : "bg-sky-500/60"}`} style={{ width: `${Math.max(6, (n / maxBar) * 100)}%` }} />
                    </span>
                    <span className="w-8 text-right font-bold text-sm tabular-nums group-hover:text-accent">{n}</span>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Recent orders */}
          <div className="mt-6 pt-5 border-t border-line">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm">Recent orders</h3>
              <Link href="/admin/orders" className="text-[13px] font-semibold text-accent hover:underline">View all</Link>
            </div>
            {recentOrders.length === 0 ? (
              <p className="text-sm text-muted">No orders yet.</p>
            ) : (
              <div className="space-y-1">
                {recentOrders.map((o) => {
                  const meta = ORDER_STATUS[o.status] ?? { label: o.status, tone: "neutral" as const };
                  return (
                    <Link key={o.id} href={`/admin/orders/${o.id}`} className="flex items-center gap-3 px-2 py-2 -mx-2 rounded-[var(--radius-control)] hover:bg-surface2 transition-colors">
                      <span className="font-bold text-[13px] w-20 shrink-0">{o.orderNumber}</span>
                      <span className="text-[13px] text-muted truncate flex-1">{o.customerName}</span>
                      <span className="text-[13px] font-semibold tabular-nums hidden sm:block">{money(o.total, o.currency)}</span>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="font-display font-bold mb-3">Revenue · last 7 days</h2>
            <div className="flex items-end justify-between gap-1.5 h-24" role="img" aria-label="Revenue bar chart for the last 7 days">
              {revenue7d.map((r, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="flex-1 w-full max-w-7 rounded-md bg-accent/75 group relative" style={{ height: `${Math.max(4, (r.value / maxRev) * 100)}%` }} title={money(r.value)} />
                  <span className="text-[10px] text-faint font-semibold">{r.day}</span>
                </div>
              ))}
            </div>
            <p className="text-[12px] text-faint mt-2">Paid orders only · {money(revenue7d.reduce((s, r) => s + r.value, 0))} total</p>
          </div>

          <div className="card p-5">
            <h2 className="font-display font-bold mb-3">Windows agent</h2>
            {liveAgents.length === 0 ? (
              <p className="text-sm text-muted">No agents paired.</p>
            ) : (
              liveAgents.map((a) => {
                const fresh = a.lastHeartbeatAt && Date.now() - new Date(a.lastHeartbeatAt).getTime() < 120000;
                const state = a.status === "never_connected" ? "never_connected" : fresh ? a.status : "disconnected";
                const tone = state === "connected" ? "success" : state === "working" ? "teal" : state === "disconnected" ? "danger" : "neutral";
                return (
                  <Link href="/admin/devices" key={a.id} className="flex items-center gap-3 py-1.5 group">
                    <StatusDot tone={tone} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold truncate group-hover:text-accent transition-colors">{a.name}</p>
                      <p className="text-[11.5px] text-faint">Heartbeat {timeAgo(a.lastHeartbeatAt)} · v{a.version}</p>
                    </div>
                    {a.testMode && <Badge tone="warning">Test</Badge>}
                  </Link>
                );
              })
            )}
          </div>

          <div className="card p-5">
            <h2 className="font-display font-bold mb-3">Printers</h2>
            {shopPrinters.length === 0 ? (
              <p className="text-sm text-muted">No printers registered.</p>
            ) : (
              shopPrinters.map((p) => {
                const meta = PRINTER_STATUS[p.status] ?? { label: p.status, tone: "neutral" as const };
                return (
                  <Link href="/admin/devices" key={p.id} className="flex items-center gap-3 py-1.5">
                    <Icon name="printer" size={16} className="text-muted" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold truncate">{p.name}</p>
                      <p className="text-[11.5px] text-faint">{p.jobsPrinted} jobs printed{p.isDefault ? " · default" : ""}</p>
                    </div>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
