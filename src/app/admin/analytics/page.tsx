import { notFound } from "next/navigation";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { orderItems, orders, printJobs } from "@/db/schema";
import { getAdminContext } from "@/lib/admin-context";
import { Icon } from "@/components/ui";
import { money, ORDER_STATUS } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const ctx = await getAdminContext();
  if (!ctx.user || !ctx.activeShop) notFound();
  const shopId = ctx.activeShop.id;

  const [totals] = await db
    .select({ n: count(), revenue: sql<number>`coalesce(sum(case when ${orders.paymentStatus}='paid' then ${orders.total} else 0 end),0)::int` })
    .from(orders)
    .where(eq(orders.shopId, shopId));

  const allOrders = await db.select({ status: orders.status, total: orders.total, paymentMethod: orders.paymentMethod, paymentStatus: orders.paymentStatus, createdAt: orders.createdAt }).from(orders).where(eq(orders.shopId, shopId));
  const byStatus: Record<string, number> = {};
  const byPay: Record<string, { count: number; revenue: number }> = {};
  for (const o of allOrders) {
    byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    const key = o.paymentMethod === "online" ? "Online" : "Counter";
    byPay[key] ??= { count: 0, revenue: 0 };
    byPay[key].count += 1;
    if (o.paymentStatus === "paid") byPay[key].revenue += o.total;
  }

  const items = await db.select({ config: orderItems.config, pages: orderItems.pages, sheets: orderItems.sheets }).from(orderItems).where(eq(orderItems.shopId, shopId));
  let colorPages = 0;
  let bwPages = 0;
  let totalSheets = 0;
  for (const it of items) {
    const cfg = (it.config ?? {}) as Record<string, unknown>;
    if (cfg.colorMode === "color") colorPages += it.pages * Number(cfg.copies ?? 1);
    else bwPages += it.pages * Number(cfg.copies ?? 1);
    totalSheets += it.sheets * Number(cfg.copies ?? 1);
  }

  const jobs = await db.select({ status: printJobs.status, attempts: printJobs.attempts, createdAt: printJobs.createdAt, completedAt: printJobs.completedAt }).from(printJobs).where(eq(printJobs.shopId, shopId));
  const jobCounts: Record<string, number> = {};
  let completedDurationMs = 0;
  let completedWithDuration = 0;
  for (const j of jobs) {
    jobCounts[j.status] = (jobCounts[j.status] ?? 0) + 1;
    if (j.status === "completed" && j.completedAt && j.createdAt) {
      completedDurationMs += new Date(j.completedAt).getTime() - new Date(j.createdAt).getTime();
      completedWithDuration++;
    }
  }
  const failRate = jobs.length > 0 ? Math.round(((jobCounts.failed ?? 0) / jobs.length) * 100) : 0;
  const avgDuration = completedWithDuration > 0 ? Math.round(completedDurationMs / completedWithDuration / 60000) : 0;
  const paidCount = allOrders.filter((o) => o.paymentStatus === "paid").length;
  const avgOrder = paidCount > 0 ? Math.round(Number(totals?.revenue ?? 0) / paidCount) : 0;

  const monthly: Record<string, { orders: number; revenue: number }> = {};
  for (const o of allOrders) {
    const d = new Date(o.createdAt);
    const key = d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
    monthly[key] ??= { orders: 0, revenue: 0 };
    monthly[key].orders += 1;
    if (o.paymentStatus === "paid") monthly[key].revenue += o.total;
  }
  const monthlyRows = Object.entries(monthly).slice(-6);

  const Stat = ({ icon, label, value, sub }: { icon: string; label: string; value: string; sub?: string }) => (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-semibold text-muted">{label}</span>
        <Icon name={icon} size={16} className="text-faint" />
      </div>
      <p className="font-display text-2xl font-bold mt-2 tabular-nums">{value}</p>
      {sub && <p className="text-[11.5px] text-faint mt-0.5">{sub}</p>}
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-muted text-sm mt-0.5">Computed live from your orders, jobs, and payment records. Revenue counts paid orders only.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon="orders" label="Total orders" value={String(totals?.n ?? 0)} />
        <Stat icon="chart" label="Revenue (paid)" value={money(Number(totals?.revenue ?? 0))} />
        <Stat icon="card" label="Average order value" value={money(avgOrder)} sub={`${paidCount} paid orders`} />
        <Stat icon="queue" label="Avg. time to completion" value={completedWithDuration > 0 ? `${avgDuration} min` : "—"} sub={`${completedWithDuration} completed jobs`} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <h2 className="font-display font-bold mb-3">Orders by status</h2>
          {Object.keys(byStatus).length === 0 ? (
            <p className="text-sm text-muted py-4">No orders yet.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(byStatus)
                .sort((a, b) => b[1] - a[1])
                .map(([s, n]) => {
                  const meta = ORDER_STATUS[s] ?? { label: s, tone: "neutral" as const };
                  const max = Math.max(...Object.values(byStatus));
                  return (
                    <div key={s} className="flex items-center gap-3">
                      <span className="w-36 text-[12.5px] font-semibold text-muted shrink-0 truncate">{meta.label}</span>
                      <span className="flex-1 h-4 rounded bg-[var(--track)] overflow-hidden">
                        <span className="block h-full rounded bg-accent/75" style={{ width: `${Math.max(4, (n / max) * 100)}%` }} />
                      </span>
                      <span className="w-10 text-right font-bold text-sm tabular-nums">{n}</span>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="font-display font-bold mb-3">Print volume</h2>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-raised border border-line rounded-[var(--radius-card)] p-4">
              <p className="font-display text-2xl font-bold tabular-nums">{totalSheets}</p>
              <p className="text-[11.5px] text-faint mt-1">sheets ordered</p>
            </div>
            <div className="bg-raised border border-line rounded-[var(--radius-card)] p-4">
              <p className="font-display text-2xl font-bold tabular-nums">{bwPages}</p>
              <p className="text-[11.5px] text-faint mt-1">B&amp;W pages</p>
            </div>
            <div className="bg-raised border border-line rounded-[var(--radius-card)] p-4">
              <p className="font-display text-2xl font-bold tabular-nums">{colorPages}</p>
              <p className="text-[11.5px] text-faint mt-1">colour pages</p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-line space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-muted">Print jobs</span><span className="font-bold">{jobs.length}</span></div>
            <div className="flex justify-between"><span className="text-muted">Completed</span><span className="font-bold text-emerald-500">{jobCounts.completed ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-muted">Failed</span><span className={`font-bold ${failRate > 10 ? "text-red-400" : ""}`}>{jobCounts.failed ?? 0} ({failRate}%)</span></div>
            <div className="flex justify-between"><span className="text-muted">Retried attempts</span><span className="font-bold">{jobs.reduce((s, j) => s + Math.max(0, j.attempts - 1), 0)}</span></div>
          </div>
        </div>

        <div className="card p-5">
          <h2 className="font-display font-bold mb-3">Revenue by payment method</h2>
          {Object.keys(byPay).length === 0 ? (
            <p className="text-sm text-muted py-4">No payments yet.</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(byPay).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between bg-raised border border-line rounded-[var(--radius-card)] px-4 py-3">
                  <div>
                    <p className="font-bold text-sm">{k}</p>
                    <p className="text-[11.5px] text-faint">{v.count} orders</p>
                  </div>
                  <p className="font-display font-bold text-lg tabular-nums">{money(v.revenue)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="font-display font-bold mb-3">Monthly summary</h2>
          {monthlyRows.length === 0 ? (
            <p className="text-sm text-muted py-4">No data yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-wide text-faint border-b border-line">
                  <th className="py-2 font-bold">Month</th>
                  <th className="py-2 font-bold text-right">Orders</th>
                  <th className="py-2 font-bold text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {monthlyRows.map(([m, v]) => (
                  <tr key={m} className="border-b border-line last:border-0">
                    <td className="py-2.5 font-semibold">{m}</td>
                    <td className="py-2.5 text-right tabular-nums">{v.orders}</td>
                    <td className="py-2.5 text-right font-bold tabular-nums">{money(v.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
