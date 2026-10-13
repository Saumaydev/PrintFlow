"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Badge, Button, EmptyState, Icon, Spinner } from "@/components/ui";
import { formatDate, money, ORDER_STATUS } from "@/lib/utils";

export default function AdminOrdersPage() {
  return (
    <Suspense fallback={<div className="p-10 grid place-items-center text-muted"><Spinner /></div>}>
      <OrdersInner />
    </Suspense>
  );
}

type OrderRow = {
  id: string;
  orderNumber: string;
  customerName: string;
  phone: string | null;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  total: number;
  currency: string;
  createdAt: string;
  itemCount: number;
  jobStatuses: string[];
};

const FILTERS = ["all", "awaiting_payment", "waiting_approval", "queued", "printing", "ready", "completed", "failed", "cancelled"];

function OrdersInner() {
  const params = useSearchParams();
  const [status, setStatus] = useState(params.get("status") ?? "all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ orders: OrderRow[]; total: number; page: number; pageSize: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (st: string, query: string, pg: number) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ status: st, page: String(pg) });
      if (query) qs.set("q", query);
      const res = await fetch(`/api/admin/orders?${qs}`);
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error?.message ?? "Failed to load orders");
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(status, q, page), q ? 350 : 0);
    return () => clearTimeout(t);
  }, [status, q, page, load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Orders</h1>
          <p className="text-muted text-sm mt-0.5">{data?.total ?? "…"} orders</p>
        </div>
        <div className="relative">
          <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input-base pl-9 w-64" placeholder="Search number, name, phone…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search orders" />
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap mb-4" role="tablist" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={status === f}
            onClick={() => { setStatus(f); setPage(1); }}
            className={`px-3 h-8 rounded-full text-[12.5px] font-bold border transition-colors ${status === f ? "bg-accent text-onaccent border-accent" : "border-line text-muted hover:text-fg"}`}
          >
            {f === "all" ? "All" : ORDER_STATUS[f]?.label ?? f}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {error && <div className="p-6 text-sm text-red-400">{error}</div>}
        {loading && !data ? (
          <div className="p-10 grid place-items-center text-muted"><Spinner /></div>
        ) : data && data.orders.length === 0 ? (
          <EmptyState icon="orders" title="No orders match" hint="Try another filter or search term — or share your shop QR to get orders flowing." />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11.5px] uppercase tracking-wide text-faint border-b border-line">
                    <th className="px-4 py-3 font-bold">Order</th>
                    <th className="px-4 py-3 font-bold">Customer</th>
                    <th className="px-4 py-3 font-bold">Placed</th>
                    <th className="px-4 py-3 font-bold">Payment</th>
                    <th className="px-4 py-3 font-bold">Status</th>
                    <th className="px-4 py-3 font-bold text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.orders.map((o) => {
                    const meta = ORDER_STATUS[o.status] ?? { label: o.status, tone: "neutral" as const };
                    return (
                      <tr key={o.id} className="border-b border-line last:border-0 hover:bg-surface2/60 transition-colors">
                        <td className="px-4 py-3">
                          <Link href={`/admin/orders/${o.id}`} className="font-bold text-accent hover:underline">{o.orderNumber}</Link>
                          <p className="text-[11.5px] text-faint">{o.itemCount} item{o.itemCount !== 1 ? "s" : ""}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold">{o.customerName}</p>
                          <p className="text-[11.5px] text-faint">{o.phone ?? "no phone"}</p>
                        </td>
                        <td className="px-4 py-3 text-muted">{formatDate(o.createdAt)}</td>
                        <td className="px-4 py-3">
                          <Badge tone={o.paymentStatus === "paid" ? "success" : o.paymentStatus === "failed" ? "danger" : "warning"}>
                            {o.paymentStatus === "paid" ? "Paid" : o.paymentStatus === "failed" ? "Failed" : "Pending"}
                          </Badge>
                          <p className="text-[11.5px] text-faint mt-1">{o.paymentMethod === "online" ? "Online" : "Counter"}</p>
                        </td>
                        <td className="px-4 py-3"><Badge tone={meta.tone}>{meta.label}</Badge></td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums">{money(o.total, o.currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-[var(--border)]">
              {data?.orders.map((o) => {
                const meta = ORDER_STATUS[o.status] ?? { label: o.status, tone: "neutral" as const };
                return (
                  <Link key={o.id} href={`/admin/orders/${o.id}`} className="flex items-center gap-3 p-4 active:bg-surface2">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-sm">{o.orderNumber} · <span className="text-muted font-semibold">{o.customerName}</span></p>
                      <p className="text-[12px] text-faint mt-0.5">{formatDate(o.createdAt)} · {o.paymentStatus === "paid" ? "Paid" : "Payment pending"}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-sm tabular-nums">{money(o.total, o.currency)}</p>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </div>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-5">
          <Button size="sm" variant="secondary" icon="chevronLeft" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
          <span className="text-sm text-muted font-semibold">Page {page} / {totalPages}</span>
          <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next <Icon name="chevronRight" size={15} /></Button>
        </div>
      )}
    </div>
  );
}
