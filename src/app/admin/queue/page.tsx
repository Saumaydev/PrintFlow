"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Badge, Button, EmptyState, Icon, Spinner, useToast } from "@/components/ui";
import { JOB_STATUS, PROGRESS_STAGES, timeAgo } from "@/lib/utils";

type JobRow = {
  id: string;
  label: string;
  kind: string;
  status: string;
  progressStage: string | null;
  orderId: string | null;
  orderNumber: string;
  customerName: string;
  printerId: string | null;
  printerName: string | null;
  priority: number;
  attempts: number;
  testMode: boolean;
  errorReason: string | null;
  createdAt: string;
  updatedAt: string;
  fileName: string | null;
  fileCleared: boolean;
  configSnapshot: Record<string, unknown>;
};

const TABS = [
  { key: "active", label: "Active" },
  { key: "queued", label: "Queued" },
  { key: "printing", label: "Printing" },
  { key: "waiting_approval", label: "Needs approval" },
  { key: "awaiting_payment", label: "Awaiting payment" },
  { key: "paused", label: "Paused" },
  { key: "failed", label: "Failed" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];

function QueueInner() {
  const params = useSearchParams();
  const { toast } = useToast();
  const initial = params.get("status") ?? "active";
  const [tab, setTab] = useState(initial === "attention" ? "failed" : initial);
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [printers, setPrinters] = useState<{ id: string; name: string; enabled: boolean }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent: boolean) => {
    try {
      const qs = tab === "all" ? "all" : tab === "active" ? "all" : tab;
      const res = await fetch(`/api/admin/jobs?status=${qs}`);
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error?.message ?? "Failed to load queue");
      let list: JobRow[] = d.jobs;
      if (tab === "active") list = list.filter((j: JobRow) => ["queued", "printing", "waiting_approval", "awaiting_payment", "paused"].includes(j.status));
      list.sort((a: JobRow, b: JobRow) => {
        const rank: Record<string, number> = { printing: 0, queued: 1, waiting_approval: 2, awaiting_payment: 3, paused: 4, failed: 5, completed: 6, cancelled: 7 };
        const r = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
        return r !== 0 ? r : a.priority - b.priority || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      setJobs(list);
      setError(null);
      setLastSync(new Date());
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : "Failed to load queue");
    }
  }, [tab]);

  const loadPrinters = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/printers");
      const d = await res.json();
      if (d.ok) setPrinters(d.printers.filter((p: { enabled: boolean }) => p.enabled));
    } catch {
      /* non-blocking */
    }
  }, []);

  useEffect(() => {
    void load(false);
    void loadPrinters();
  }, [load, loadPrinters]);

  useEffect(() => {
    if (!live) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    timer.current = setInterval(() => void load(true), 5000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [live, load]);

  const act = async (jobId: string, action: string, extra?: Record<string, unknown>) => {
    setBusy(jobId + action);
    try {
      const res = await fetch("/api/admin/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, action, ...extra }) });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error?.message ?? "Action failed");
      toast("Job updated", "success");
      void load(true);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Action failed", "danger");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Print queue</h1>
          <p className="text-muted text-sm mt-0.5">
            {lastSync ? `Synced ${lastSync.toLocaleTimeString()}` : "Loading…"} · {live ? "live refresh every 5s" : "live refresh off"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setLive((v) => !v)} className={`h-9 px-3 rounded-[var(--radius-control)] border text-[13px] font-bold inline-flex items-center gap-1.5 transition-colors ${live ? "border-accent/40 text-accent bg-accent/8" : "border-line text-muted"}`} aria-pressed={live}>
            <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-accent pulse-dot" : "bg-faint"}`} /> {live ? "Live" : "Paused"}
          </button>
          <Button variant="secondary" size="sm" icon="refresh" onClick={() => void load(false)}>Refresh</Button>
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap mb-4" role="tablist" aria-label="Filter queue">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`px-3 h-8 rounded-full text-[12.5px] font-bold border transition-colors ${tab === t.key ? "bg-accent text-onaccent border-accent" : "border-line text-muted hover:text-fg"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

      {!jobs ? (
        <div className="p-10 grid place-items-center text-muted"><Spinner size={24} /></div>
      ) : jobs.length === 0 ? (
        <div className="card">
          <EmptyState icon="queue" title="Queue is clear" hint="Jobs appear here once orders pass payment and approval gates. Share your shop QR to receive orders." />
        </div>
      ) : (
        <div className="space-y-2.5">
          {jobs.map((j) => {
            const meta = JOB_STATUS[j.status] ?? { label: j.status, tone: "neutral" as const };
            const cfg = j.configSnapshot ?? {};
            const active = ["queued", "waiting_approval", "awaiting_payment", "paused"].includes(j.status);
            return (
              <div key={j.id} className="card p-4 animate-in">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${j.status === "printing" ? "bg-accent pulse-dot" : j.status === "failed" ? "bg-red-500" : j.status === "completed" ? "bg-emerald-500" : "bg-faint"}`} />
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">
                      {j.label}
                      {j.kind === "test" && <span className="ml-2 text-[11px] font-bold text-amber-500 uppercase">Test</span>}
                      {j.testMode && j.kind !== "test" && <span className="ml-2 text-[11px] font-bold text-amber-500 uppercase">Simulated</span>}
                    </p>
                    <p className="text-[12px] text-faint truncate">
                      {j.orderId ? (
                        <Link href={`/admin/orders/${j.orderId}`} className="text-accent font-semibold hover:underline">{j.orderNumber}</Link>
                      ) : (
                        <span>{j.orderNumber}</span>
                      )}
                      {" · "}{j.customerName}
                      {j.fileName ? ` · ${j.fileName}` : ""}
                      {j.fileCleared ? " · file cleared" : ""}
                    </p>
                  </div>
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    {j.status === "printing" && j.progressStage && <Badge tone="teal">{PROGRESS_STAGES[j.progressStage] ?? j.progressStage}</Badge>}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-2.5 text-[12px] text-muted">
                  <span className="inline-flex items-center gap-1"><Icon name="clock" size={12} /> {timeAgo(j.createdAt)}</span>
                  <span>{String(cfg.colorMode === "color" ? "Colour" : "B&W")} · {String(cfg.paperSize ?? "A4")} · {Number(cfg.copies ?? 1)}×</span>
                  {j.printerName && <span className="inline-flex items-center gap-1"><Icon name="printer" size={12} /> {j.printerName}</span>}
                  {j.attempts > 1 && <span className="text-amber-500 font-semibold">{j.attempts} attempts</span>}
                  {j.errorReason && <span className="text-red-400 font-semibold">⚠ {j.errorReason}</span>}
                </div>

                {active && (
                  <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-line">
                    {j.status === "queued" && (
                      <select className="input-base h-8 w-auto text-[12.5px]" value={j.printerId ?? ""} onChange={(e) => e.target.value && void act(j.id, "assign", { printerId: e.target.value })} aria-label="Assign printer">
                        <option value="">Auto-assign printer</option>
                        {printers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    )}
                    <select className="input-base h-8 w-auto text-[12.5px]" value={j.priority} onChange={(e) => void act(j.id, "priority", { priority: Number(e.target.value) })} aria-label="Priority">
                      <option value={1}>P1 · urgent</option>
                      <option value={2}>P2 · high</option>
                      <option value={3}>P3 · normal</option>
                      <option value={4}>P4 · low</option>
                      <option value={5}>P5 · batch</option>
                    </select>
                    <span className="flex-1" />
                    {j.status === "queued" && <Button size="sm" variant="secondary" icon="pause" loading={busy === j.id + "pause"} onClick={() => void act(j.id, "pause")}>Pause</Button>}
                    {j.status === "paused" && <Button size="sm" variant="primary" icon="play" loading={busy === j.id + "resume"} onClick={() => void act(j.id, "resume")}>Resume</Button>}
                    {j.status === "waiting_approval" && (
                      <Link href={`/admin/orders/${j.orderId}`}><Button size="sm" variant="primary" icon="check">Approve in order</Button></Link>
                    )}
                    {j.status === "awaiting_payment" && (
                      <Link href={`/admin/orders/${j.orderId}`}><Button size="sm" variant="primary" icon="card">Record payment</Button></Link>
                    )}
                    <Button size="sm" variant="danger" icon="x" loading={busy === j.id + "cancel"} onClick={() => void act(j.id, "cancel")}>Cancel</Button>
                  </div>
                )}
                {j.status === "failed" && (
                  <div className="flex gap-2 mt-3 pt-3 border-t border-line">
                    <Button size="sm" variant="primary" icon="refresh" loading={busy === j.id + "retry"} onClick={() => void act(j.id, "retry")}>Retry job</Button>
                    <Button size="sm" variant="danger" icon="x" loading={busy === j.id + "cancel"} onClick={() => void act(j.id, "cancel")}>Cancel</Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function QueuePage() {
  return (
    <Suspense fallback={<div className="p-10 grid place-items-center text-muted"><Spinner /></div>}>
      <QueueInner />
    </Suspense>
  );
}
