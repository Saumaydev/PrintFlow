"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge, Button, EmptyState, Icon, Modal, Spinner, useToast } from "@/components/ui";
import { formatDate, money, ORDER_STATUS, PAYMENT_STATUS, JOB_STATUS, PROGRESS_STAGES } from "@/lib/utils";

type Detail = {
  order: { id: string; orderNumber: string; customerName: string; phone: string | null; email: string | null; note: string | null; status: string; paymentMethod: string; paymentStatus: string; currency: string; subtotal: number; taxAmount: number; total: number; pricingVersion: number; createdAt: string; priceSnapshot: unknown };
  items: { id: string; label: string; config: Record<string, unknown>; pages: number; sheets: number; lineTotal: number; documentId: string | null }[];
  payments: { id: string; provider: string; method: string; providerRef: string | null; amount: number; status: string; verifiedBy: string | null; createdAt: string }[];
  jobs: { id: string; label: string; status: string; progressStage: string | null; testMode: boolean; attempts: number; errorReason: string | null; printerId: string | null; createdAt: string; startedAt: string | null; completedAt: string | null }[];
  events: { type: string; note: string | null; actor: string; createdAt: string }[];
  documents: { id: string; fileName: string; filesClearedAt: string | null; status: string }[];
  jobEvents: { id: string; jobId: string; stage: string; detail: string | null; source: string; createdAt: string }[];
};

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelModal, setCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [payModal, setPayModal] = useState(false);
  const [payMethod, setPayMethod] = useState("cash");
  const [reprintModal, setReprintModal] = useState<string | null>(null);
  const [reprintReason, setReprintReason] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/order?id=${id}`);
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error?.message ?? "Failed to load order");
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load order");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const action = async (key: string, body: Record<string, unknown>, successMsg: string) => {
    setBusy(key);
    try {
      const res = await fetch("/api/admin/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error?.message ?? "Action failed");
      toast(successMsg, "success");
      setCancelModal(false);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Action failed", "danger");
    } finally {
      setBusy(null);
    }
  };

  const recordPayment = async () => {
    setBusy("pay");
    try {
      const res = await fetch("/api/admin/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: id, method: payMethod, note: "Recorded at counter" }) });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error?.message ?? "Could not record payment");
      toast("Payment recorded — order released according to operating mode", "success");
      setPayModal(false);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not record payment", "danger");
    } finally {
      setBusy(null);
    }
  };

  const reprint = async (jobId: string) => {
    setBusy("reprint");
    try {
      const res = await fetch("/api/admin/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reprint", jobId, reason: reprintReason }) });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error?.message ?? "Reprint failed");
      toast("Reprint job created and queued", "success");
      setReprintModal(null);
      setReprintReason("");
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Reprint failed", "danger");
    } finally {
      setBusy(null);
    }
  };

  const jobAction = async (jobId: string, act: string) => {
    setBusy(act + jobId);
    try {
      const res = await fetch("/api/admin/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: act, jobId }) });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error?.message ?? "Action failed");
      toast("Job updated", "success");
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Action failed", "danger");
    } finally {
      setBusy(null);
    }
  };

  if (error) return <EmptyState icon="alert" title="Could not load order" hint={error} action={<Link href="/admin/orders"><Button variant="secondary">Back to orders</Button></Link>} />;
  if (!data) return <div className="p-10 grid place-items-center text-muted"><Spinner size={26} /></div>;

  const { order, items, payments, jobs, events, documents, jobEvents } = data;
  const meta = ORDER_STATUS[order.status] ?? { label: order.status, tone: "neutral" as const };

  return (
    <div className="space-y-5">
      <Link href="/admin/orders" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-fg transition-colors">
        <Icon name="chevronLeft" size={15} /> All orders
      </Link>

      <div className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-2xl font-bold">{order.orderNumber}</h1>
              <Badge tone={meta.tone}>{meta.label}</Badge>
              <Badge tone={order.paymentStatus === "paid" ? "success" : "warning"}>{order.paymentStatus === "paid" ? "Paid" : "Payment pending"}</Badge>
            </div>
            <p className="text-sm text-muted mt-1.5">
              {order.customerName}{order.phone ? ` · ${order.phone}` : ""}{order.email ? ` · ${order.email}` : ""}
            </p>
            <p className="text-[13px] text-faint mt-0.5">Placed {formatDate(order.createdAt)} · pricing v{order.pricingVersion} · {order.paymentMethod === "online" ? "online payment" : "pay at counter"}</p>
            {order.note && <p className="mt-3 text-[13px] bg-raised border border-line rounded-[var(--radius-control)] px-3 py-2 inline-block">📝 {order.note}</p>}
          </div>
          <div className="text-right">
            <p className="font-display text-3xl font-bold tabular-nums">{money(order.total, order.currency)}</p>
            <p className="text-[12px] text-faint">subtotal {money(order.subtotal, order.currency)} + GST {money(order.taxAmount, order.currency)}</p>
          </div>
        </div>

        {/* Contextual actions */}
        <div className="flex flex-wrap gap-2 mt-5 pt-5 border-t border-line">
          {order.paymentStatus !== "paid" && !["cancelled", "rejected"].includes(order.status) && (
            <Button variant="primary" icon="card" loading={busy === "pay"} onClick={() => setPayModal(true)}>Record counter payment</Button>
          )}
          {order.status === "waiting_approval" && <Button variant="primary" icon="check" loading={busy === "approve"} onClick={() => void action("approve", { action: "approve" }, "Order approved and released to the queue")}>Approve &amp; release</Button>}
          {["printing", "quality_check", "queued", "ready"].includes(order.status) && order.status !== "ready" && (
            <Button variant="secondary" icon="check" loading={busy === "ready"} onClick={() => void action("ready", { action: "ready" }, "Order marked ready for pickup")}>Mark ready</Button>
          )}
          {order.status === "ready" && <Button variant="primary" icon="check" loading={busy === "complete"} onClick={() => void action("complete", { action: "complete" }, "Order completed")}>Complete order</Button>}
          {order.status === "received" && <Button variant="secondary" icon="x" loading={busy === "reject"} onClick={() => void action("reject", { action: "reject", reason: "Rejected by shop" }, "Order rejected")}>Reject</Button>}
          {!["completed", "cancelled", "rejected"].includes(order.status) && (
            <Button variant="danger" icon="trash" loading={busy === "cancel"} onClick={() => setCancelModal(true)}>Cancel order</Button>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Items & documents */}
        <div className="card p-5">
          <h2 className="font-display font-bold mb-3">Items &amp; documents</h2>
          <div className="space-y-3">
            {items.map((it) => {
              const cfg = it.config as Record<string, unknown>;
              const doc = documents.find((d) => d.id === it.documentId);
              return (
                <div key={it.id} className="bg-raised border border-line rounded-[var(--radius-card)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-sm truncate">{it.label}</p>
                      <p className="text-[12px] text-muted mt-1">
                        {String(cfg.colorMode === "color" ? "Colour" : "B&W")} · {String(cfg.paperSize ?? "A4")} · {String(cfg.orientation ?? "auto")} · {Number(cfg.copies ?? 1)}×
                        {String(cfg.duplex ?? "off") !== "off" ? ` · duplex (${String(cfg.duplex)})` : ""}
                        {Number(cfg.pagesPerSheet ?? 1) > 1 ? ` · ${cfg.pagesPerSheet}-up` : ""}
                        {String(cfg.pageRange ?? "all") !== "all" ? ` · pages ${String(cfg.pageRange)}` : ""}
                        {String(cfg.scaling ?? "") ? ` · ${String(cfg.scaling)}` : ""}
                      </p>
                      {(Array.isArray(cfg.finishing) ? (cfg.finishing as string[]) : []).length > 0 && (
                        <p className="text-[12px] text-accent mt-0.5">Finishing: {(cfg.finishing as string[]).join(", ")}</p>
                      )}
                      {Boolean(cfg.urgent) && <p className="text-[12px] text-amber-500 mt-0.5">⚡ Urgent priority</p>}
                      <p className="text-[11.5px] text-faint mt-1">{it.pages} pages → {it.sheets} sheets</p>
                    </div>
                    <span className="font-bold text-sm tabular-nums shrink-0">{money(it.lineTotal, order.currency)}</span>
                  </div>
                  {doc && (
                    <div className="mt-2.5 pt-2.5 border-t border-line flex items-center gap-2 text-[12px]">
                      <Icon name={doc.filesClearedAt ? "shield" : "file"} size={14} className={doc.filesClearedAt ? "text-faint" : "text-muted"} />
                      {doc.filesClearedAt ? (
                        <span className="text-faint">{doc.fileName} — source file securely cleared on {formatDate(doc.filesClearedAt)}</span>
                      ) : (
                        <>
                          <span className="text-muted">{doc.fileName}</span>
                          <a href={`/api/documents/${doc.id}/file`} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 font-semibold text-accent hover:underline">
                            <Icon name="eye" size={13} /> View file
                          </a>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Payments + timeline */}
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="font-display font-bold mb-3">Payments</h2>
            {payments.length === 0 ? (
              <p className="text-sm text-muted">No payments recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {payments.map((p) => {
                  const pm = PAYMENT_STATUS[p.status] ?? { label: p.status, tone: "neutral" as const };
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-3 bg-raised border border-line rounded-[var(--radius-control)] px-3.5 py-2.5">
                      <div className="text-[13px]">
                        <p className="font-semibold">{p.provider === "counter" ? `Counter · ${p.method}` : p.provider === "cashfree" ? "Cashfree" : "Sandbox gateway"}</p>
                        <p className="text-[11.5px] text-faint">{formatDate(p.createdAt)}{p.verifiedBy ? ` · verified by ${p.verifiedBy}` : ""}{p.providerRef ? ` · ${p.providerRef}` : ""}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm tabular-nums">{money(p.amount, order.currency)}</span>
                        <Badge tone={pm.tone}>{pm.label}</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card p-5">
            <h2 className="font-display font-bold mb-3">Order timeline</h2>
            <ol className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
              {[...events].reverse().map((e, i) => (
                <li key={i} className="flex gap-2.5 text-[13px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent mt-1.5 shrink-0" />
                  <div>
                    <span className="font-semibold">{ORDER_STATUS[e.type]?.label ?? e.type.replace(/_/g, " ")}</span>
                    {e.note && <span className="text-muted"> — {e.note}</span>}
                    <span className="block text-[11px] text-faint">{formatDate(e.createdAt)} · {e.actor}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      {/* Print jobs */}
      <div className="card p-5">
        <h2 className="font-display font-bold mb-3">Print jobs ({jobs.length})</h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-muted">No print jobs for this order.</p>
        ) : (
          <div className="space-y-3">
            {jobs.map((j) => {
              const jm = JOB_STATUS[j.status] ?? { label: j.status, tone: "neutral" as const };
              const evts = jobEvents.filter((e) => e.jobId === j.id);
              return (
                <div key={j.id} className="bg-raised border border-line rounded-[var(--radius-card)] p-4">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="font-bold text-sm">{j.label}</span>
                    <Badge tone={jm.tone}>{jm.label}</Badge>
                    {j.testMode && <Badge tone="warning">Test mode</Badge>}
                    {j.status === "printing" && j.progressStage && <Badge tone="teal">{PROGRESS_STAGES[j.progressStage] ?? j.progressStage}</Badge>}
                    <span className="ml-auto flex flex-wrap gap-1.5">
                      {j.status === "queued" && <Button size="sm" variant="secondary" icon="pause" loading={busy === `pause${j.id}`} onClick={() => void jobAction(j.id, "pause")}>Pause</Button>}
                      {j.status === "paused" && <Button size="sm" variant="secondary" icon="play" loading={busy === `resume${j.id}`} onClick={() => void jobAction(j.id, "resume")}>Resume</Button>}
                      {j.status === "failed" && <Button size="sm" variant="secondary" icon="refresh" loading={busy === `retry${j.id}`} onClick={() => void jobAction(j.id, "retry")}>Retry</Button>}
                      {j.status === "completed" && <Button size="sm" variant="secondary" icon="rotate" onClick={() => setReprintModal(j.id)}>Reprint</Button>}
                      {!["completed", "cancelled"].includes(j.status) && <Button size="sm" variant="danger" icon="x" loading={busy === `cancel${j.id}`} onClick={() => void jobAction(j.id, "cancel")}>Cancel job</Button>}
                    </span>
                  </div>
                  {j.errorReason && <p className="text-[12.5px] font-medium text-red-400 mt-2">Error: {j.errorReason}</p>}
                  <p className="text-[11.5px] text-faint mt-1.5">
                    Created {formatDate(j.createdAt)}{j.startedAt ? ` · started ${formatDate(j.startedAt)}` : ""}{j.completedAt ? ` · finished ${formatDate(j.completedAt)}` : ""} · {j.attempts} attempt{j.attempts !== 1 ? "s" : ""}
                  </p>
                  {evts.length > 0 && (
                    <details className="mt-2">
                      <summary className="text-[12.5px] font-semibold text-accent cursor-pointer select-none">Execution log ({evts.length})</summary>
                      <ol className="mt-2 space-y-1 text-[12px] text-muted">
                        {evts.map((e) => (
                          <li key={e.id} className="flex gap-2">
                            <span className="text-faint shrink-0">{formatDate(e.createdAt)}</span>
                            <span className="font-semibold text-fg">{e.stage}</span>
                            {e.detail && <span className="truncate">— {e.detail}</span>}
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Cancel modal */}
      <Modal open={cancelModal} onClose={() => setCancelModal(false)} title="Cancel this order?">
        <p className="text-sm text-muted">The order and its queued jobs will be cancelled. Printing already submitted to the spooler may not be stoppable. This action is recorded in the audit log.</p>
        <div className="mt-4">
          <label className="block text-[13px] font-semibold text-muted mb-1.5">Reason (optional)</label>
          <input className="input-base" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Customer requested cancellation" />
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={() => setCancelModal(false)}>Keep order</Button>
          <Button variant="danger" loading={busy === "cancel"} onClick={() => void action("cancel", { action: "cancel", reason: cancelReason || "Cancelled by staff" }, "Order cancelled")}>Cancel order</Button>
        </div>
      </Modal>

      {/* Record payment modal */}
      <Modal open={payModal} onClose={() => setPayModal(false)} title="Record counter payment">
        <p className="text-sm text-muted">Confirm you received <strong className="text-fg">{money(order.total, order.currency)}</strong> from {order.customerName}. The order will be released according to the shop&apos;s operating mode.</p>
        <div className="mt-4">
          <label className="block text-[13px] font-semibold text-muted mb-1.5">Method</label>
          <select className="input-base" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="upi">UPI at counter</option>
            <option value="card">Card machine</option>
          </select>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={() => setPayModal(false)}>Back</Button>
          <Button variant="primary" loading={busy === "pay"} onClick={recordPayment}>Confirm payment received</Button>
        </div>
      </Modal>

      {/* Reprint modal */}
      <Modal open={reprintModal !== null} onClose={() => setReprintModal(null)} title="Reprint this job">
        <p className="text-sm text-muted">Creates a new linked print attempt. The original job history is preserved.</p>
        <div className="mt-4">
          <label className="block text-[13px] font-semibold text-muted mb-1.5">Reason (required)</label>
          <input className="input-base" value={reprintReason} onChange={(e) => setReprintReason(e.target.value)} placeholder="Paper jam, quality issue, customer request…" />
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={() => setReprintModal(null)}>Back</Button>
          <Button variant="primary" disabled={reprintReason.trim().length < 3} loading={busy === "reprint"} onClick={() => reprintModal && reprint(reprintModal)}>Create reprint job</Button>
        </div>
      </Modal>
    </div>
  );
}
