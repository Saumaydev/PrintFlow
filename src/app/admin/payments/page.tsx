"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, EmptyState, Icon, Spinner } from "@/components/ui";
import { formatDate, money, PAYMENT_STATUS } from "@/lib/utils";

type PaymentRow = { id: string; orderId: string; orderNumber: string; provider: string; method: string; providerRef: string | null; amount: number; currency: string; status: string; verifiedBy: string | null; createdAt: string };

export default function PaymentsPage() {
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "paid" | "pending" | "failed">("all");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/payments");
        const d = await res.json();
        if (!res.ok || !d.ok) throw new Error(d?.error?.message ?? "Failed to load payments");
        setRows(d.payments);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load payments");
      }
    })();
  }, []);

  const filtered = rows?.filter((p) => filter === "all" || p.status === filter) ?? [];
  const totals = {
    paid: rows?.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0) ?? 0,
    pending: rows?.filter((p) => p.status === "pending").length ?? 0,
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Payments</h1>
          <p className="text-muted text-sm mt-0.5">
            {money(totals.paid)} collected · {totals.pending} pending confirmation
          </p>
        </div>
        <div className="flex gap-1.5">
          {(["all", "paid", "pending", "failed"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 h-8 rounded-full text-[12.5px] font-bold border transition-colors capitalize ${filter === f ? "bg-accent text-onaccent border-accent" : "border-line text-muted hover:text-fg"}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        {error && <p className="p-6 text-sm text-red-400">{error}</p>}
        {!rows && !error ? (
          <div className="p-10 grid place-items-center text-muted"><Spinner /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="card" title="No payment records" hint={filter !== "all" ? "Try another filter." : "Payments appear here when customers pay online or staff record counter payments."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-wide text-faint border-b border-line">
                  <th className="px-4 py-3 font-bold">When</th>
                  <th className="px-4 py-3 font-bold">Order</th>
                  <th className="px-4 py-3 font-bold">Method</th>
                  <th className="px-4 py-3 font-bold">Reference</th>
                  <th className="px-4 py-3 font-bold">Status</th>
                  <th className="px-4 py-3 font-bold text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const meta = PAYMENT_STATUS[p.status] ?? { label: p.status, tone: "neutral" as const };
                  return (
                    <tr key={p.id} className="border-b border-line last:border-0 hover:bg-surface2/60 transition-colors">
                      <td className="px-4 py-3 text-muted whitespace-nowrap">{formatDate(p.createdAt)}</td>
                      <td className="px-4 py-3"><Link href={`/admin/orders/${p.orderId}`} className="font-bold text-accent hover:underline">{p.orderNumber}</Link></td>
                      <td className="px-4 py-3">
                        <span className="font-semibold">{p.provider === "counter" ? "Counter" : p.provider === "cashfree" ? "Cashfree" : "Sandbox"}</span>
                        <span className="text-faint text-[12px]"> · {p.method}</span>
                        {p.verifiedBy && <p className="text-[11px] text-faint">verified by {p.verifiedBy}</p>}
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] text-muted">{p.providerRef ?? "—"}</td>
                      <td className="px-4 py-3"><Badge tone={meta.tone}>{meta.label}</Badge></td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums">{money(p.amount, p.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[12px] text-faint mt-3 flex items-center gap-1.5"><Icon name="info" size={13} /> Online payments are only marked paid after server-side verification (provider webhook or confirmed gateway response) — never by a browser redirect.</p>
    </div>
  );
}
