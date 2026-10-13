"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge, Button, Icon, Modal, useToast } from "@/components/ui";
import { money, formatDate, ORDER_STATUS, ORDER_TIMELINE, JOB_STATUS, PROGRESS_STAGES } from "@/lib/utils";

type TrackData = {
  order: { orderNumber: string; customerName: string; status: string; paymentMethod: string; paymentStatus: string; currency: string; subtotal: number; taxAmount: number; total: number; note: string | null; createdAt: string };
  shop: { name: string; slug: string; address: string; phone: string } | null;
  items: { id: string; label: string; config: Record<string, unknown>; pages: number; sheets: number; lineTotal: number; fileCleared: boolean; needsConversion: boolean }[];
  payments: { id: string; provider: string; method: string; amount: number; status: string; createdAt: string }[];
  jobs: { id: string; status: string; progressStage: string | null; testMode: boolean; errorReason: string | null; createdAt: string; startedAt: string | null; completedAt: string | null }[];
  timeline: { type: string; note: string | null; actor: string; createdAt: string }[];
  canPayOnline: boolean;
};

export default function TrackPage() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const [data, setData] = useState<TrackData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [payModal, setPayModal] = useState<{ open: boolean; paymentId: string | null; done: boolean; busy: boolean }>({ open: false, paymentId: null, done: false, busy: false });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${token}`);
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error?.message ?? "Order not found");
      setData(d);
      setError(null);
      const active = !["completed", "cancelled", "rejected", "ready"].includes(d.order.status);
      if (timer.current) clearInterval(timer.current);
      if (active) timer.current = setInterval(() => void load(), 6000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load order");
    }
  }, [token]);

  useEffect(() => {
    void load();
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  const startPayment = async () => {
    if (!data) return;
    setPayBusy(true);
    try {
      const res = await fetch("/api/payments/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderToken: token }) });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error?.message ?? "Payment start failed");
      if (d.mode === "sandbox") setPayModal({ open: true, paymentId: d.paymentId, done: false, busy: false });
      else toast("Cashfree checkout created — complete it via the provider.", "info");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Payment start failed", "danger");
    } finally {
      setPayBusy(false);
    }
  };

  const confirmPayment = async () => {
    setPayModal((m) => ({ ...m, busy: true }));
    try {
      const res = await fetch("/api/payments/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderToken: token, paymentId: payModal.paymentId }) });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error?.message ?? "Payment confirmation failed");
      setPayModal({ open: true, paymentId: null, done: true, busy: false });
      toast("Payment confirmed!", "success");
      void load();
    } catch (err) {
      setPayModal((m) => ({ ...m, busy: false }));
      toast(err instanceof Error ? err.message : "Payment confirmation failed", "danger");
    }
  };

  if (error) {
    return (
      <main className="min-h-screen bg-bg grid place-items-center px-5">
        <div className="card p-8 max-w-md text-center">
          <Icon name="alert" size={28} className="text-amber-500 mx-auto" />
          <h1 className="font-display font-bold text-xl mt-3">Order not found</h1>
          <p className="text-sm text-muted mt-2">{error}</p>
          <Link href="/" className="inline-flex mt-5 items-center gap-2 h-10 px-5 rounded-[var(--radius-control)] bg-accent text-onaccent font-semibold">
            <Icon name="home" size={16} /> Go to PrintFlow
          </Link>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen bg-bg grid place-items-center">
        <div className="flex items-center gap-3 text-muted">
          <span className="animate-spin"><Icon name="refresh" size={20} /></span> Loading your order…
        </div>
      </main>
    );
  }

  const { order, shop, items, payments, jobs } = data;
  const st = ORDER_STATUS[order.status] ?? { label: order.status, tone: "neutral" as const };
  const reachedIndex = ORDER_TIMELINE.findIndex((t) => t.key === order.status);
  const flowIndex = ORDER_TIMELINE.findIndex((t) => t.key === order.status);
  const cancelled = ["cancelled", "rejected", "failed"].includes(order.status);

  return (
    <main className="min-h-screen bg-bg pb-16">
      <header className="max-w-3xl mx-auto px-5 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-[9px] bg-accent text-onaccent flex items-center justify-center"><Icon name="printer" size={17} strokeWidth={2} /></span>
          <span className="font-display font-bold">PrintFlow</span>
        </Link>
        {shop && <Link href={`/s/${shop.slug}`} className="text-[13px] font-semibold text-muted hover:text-fg">{shop.name}</Link>}
      </header>

      <div className="max-w-3xl mx-auto px-5 space-y-4">
        <div className="card p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[12px] text-faint uppercase tracking-wide font-bold">Order</p>
              <h1 className="font-display text-2xl sm:text-3xl font-bold">{order.orderNumber}</h1>
              <p className="text-[13px] text-muted mt-1">Placed {formatDate(order.createdAt)} · {order.customerName}</p>
            </div>
            <Badge tone={st.tone} className="text-[13px] px-3 py-1">{st.label}</Badge>
          </div>

          {/* Timeline */}
          {!cancelled && (
            <ol className="mt-6 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2" aria-label="Order progress">
              {ORDER_TIMELINE.map((step, i) => {
                const done = flowIndex >= 0 ? i < flowIndex : false;
                const current = i === reachedIndex;
                return (
                  <li key={step.key} className="flex flex-col items-center text-center gap-1.5">
                    <span className={`w-6 h-6 rounded-full grid place-items-center border text-[11px] font-bold ${current ? "bg-accent border-accent text-onaccent" : done ? "bg-accent/20 border-accent/40 text-accent" : "border-line text-faint"}`}>
                      {done ? <Icon name="check" size={12} strokeWidth={2.5} /> : i + 1}
                    </span>
                    <span className={`text-[10.5px] leading-tight font-semibold ${current ? "text-fg" : done ? "text-muted" : "text-faint"}`}>{step.label}</span>
                  </li>
                );
              })}
            </ol>
          )}
          {cancelled && (
            <p className="mt-5 text-sm font-medium text-red-400 bg-red-500/8 border border-red-500/25 rounded-[var(--radius-control)] px-3 py-2.5">
              This order is {order.status}. Contact the shop if you believe this is a mistake.
            </p>
          )}

          {/* Live print activity */}
          {jobs.some((j) => ["printing", "queued"].includes(j.status)) && (
            <div className="mt-5 bg-raised border border-line rounded-[var(--radius-card)] p-4">
              {jobs.filter((j) => ["printing", "queued"].includes(j.status)).map((j) => (
                <div key={j.id} className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-accent pulse-dot" />
                  <p className="text-sm font-semibold flex-1">
                    {j.status === "printing" && j.progressStage ? `Agent is ${PROGRESS_STAGES[j.progressStage]?.toLowerCase() ?? j.progressStage}…` : "Waiting in the print queue"}
                  </p>
                  {j.testMode && <Badge tone="warning">Test mode</Badge>}
                </div>
              ))}
            </div>
          )}
          {jobs.some((j) => j.status === "failed") && (
            <div className="mt-5 text-sm font-medium text-red-400 bg-red-500/8 border border-red-500/25 rounded-[var(--radius-card)] px-4 py-3">
              A print attempt failed{jobs.find((j) => j.status === "failed")?.errorReason ? ` (${jobs.find((j) => j.status === "failed")!.errorReason})` : ""}. The shop has been notified.
            </div>
          )}
        </div>

        {/* Payment */}
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display font-bold">Payment</h2>
              <p className="text-[13px] text-muted mt-0.5">
                {order.paymentMethod === "online" ? "Online payment" : "Pay at counter"} ·{" "}
                <span className={`font-semibold ${order.paymentStatus === "paid" ? "text-emerald-500" : "text-amber-500"}`}>{order.paymentStatus.toUpperCase()}</span>
              </p>
            </div>
            <div className="text-right">
              <p className="font-display text-2xl font-bold tabular-nums">{money(order.total, order.currency)}</p>
              <p className="text-[11.5px] text-faint">incl. {money(order.taxAmount, order.currency)} GST</p>
            </div>
          </div>
          {data.canPayOnline && (
            <Button variant="primary" size="lg" className="w-full mt-4" loading={payBusy} onClick={startPayment}>
              Pay {money(order.total, order.currency)} now
            </Button>
          )}
          {payments.length > 0 && (
            <div className="mt-4 pt-3 border-t border-line space-y-1.5">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-[13px]">
                  <span className="text-muted">{p.provider === "counter" ? `Counter (${p.method})` : p.provider === "cashfree" ? "Cashfree online" : "Sandbox gateway"} · {formatDate(p.createdAt)}</span>
                  <span className="flex items-center gap-2 font-semibold">{money(p.amount, order.currency)} <Badge tone={p.status === "paid" ? "success" : p.status === "failed" ? "danger" : "warning"}>{p.status}</Badge></span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Items */}
        <div className="card p-5">
          <h2 className="font-display font-bold mb-3">Documents ({items.length})</h2>
          <div className="space-y-3">
            {items.map((it) => {
              const cfg = it.config as Record<string, unknown>;
              return (
                <div key={it.id} className="flex items-start gap-3 bg-raised border border-line rounded-[var(--radius-control)] p-3.5">
                  <span className="w-9 h-9 rounded-lg bg-surface2 border border-line grid place-items-center text-muted shrink-0"><Icon name="file" size={16} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold truncate">{it.label}</p>
                    <p className="text-[12px] text-muted mt-0.5">
                      {String(cfg.colorMode === "color" ? "Colour" : "B&W")} · {String(cfg.paperSize ?? "A4")} · {Number(cfg.copies ?? 1)} cop{Number(cfg.copies ?? 1) > 1 ? "ies" : "y"}
                      {String(cfg.duplex ?? "off") !== "off" ? " · double-sided" : ""}
                      {Number(cfg.pagesPerSheet ?? 1) > 1 ? ` · ${cfg.pagesPerSheet}-up` : ""}
                      {String(cfg.pageRange ?? "all") !== "all" ? ` · pages ${String(cfg.pageRange)}` : ""}
                    </p>
                    <p className="text-[11.5px] text-faint mt-0.5">{it.pages} page{it.pages !== 1 ? "s" : ""} → {it.sheets} sheet{it.sheets !== 1 ? "s" : ""}</p>
                    {it.fileCleared && (
                      <p className="text-[11.5px] text-faint mt-1 inline-flex items-center gap-1"><Icon name="shield" size={12} /> Source file was securely cleared after completion — your receipt stays available.</p>
                    )}
                  </div>
                  <span className="font-bold text-sm tabular-nums">{money(it.lineTotal, order.currency)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Timeline events */}
        <div className="card p-5">
          <h2 className="font-display font-bold mb-3">History</h2>
          <ol className="space-y-2.5">
            {[...data.timeline].reverse().map((e, i) => (
              <li key={i} className="flex gap-3 text-[13px]">
                <span className="w-1.5 h-1.5 rounded-full bg-accent mt-1.5 shrink-0" />
                <div className="min-w-0">
                  <span className="font-semibold">{(ORDER_STATUS[e.type]?.label ?? JOB_STATUS[e.type]?.label ?? e.type.replace(/_/g, " "))}</span>
                  {e.note && <span className="text-muted"> — {e.note}</span>}
                  <span className="text-faint block text-[11.5px]">{formatDate(e.createdAt)}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <Modal open={payModal.open} onClose={() => setPayModal((m) => ({ ...m, open: false }))} title={payModal.done ? "Payment complete" : "Secure payment"}>
        {payModal.done ? (
          <div className="text-center py-4">
            <Icon name="check" size={34} className="text-emerald-500 mx-auto" />
            <p className="font-semibold mt-3">Payment confirmed. Your order moves to the print queue now.</p>
          </div>
        ) : (
          <div>
            <div className="bg-raised border border-line rounded-[var(--radius-card)] p-5 text-center">
              <p className="text-[13px] text-muted">Amount payable</p>
              <p className="font-display text-3xl font-bold mt-1">{money(order.total, order.currency)}</p>
              <Badge tone="warning" className="mt-3">Sandbox gateway</Badge>
            </div>
            <Button variant="primary" size="lg" className="w-full mt-4" loading={payModal.busy} onClick={confirmPayment}>
              Simulate successful payment
            </Button>
          </div>
        )}
      </Modal>
    </main>
  );
}
