"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, CopyButton, Field, Icon, Modal, Segmented, Spinner, useToast } from "@/components/ui";
import { formatBytes, formatDate, timeAgo } from "@/lib/utils";

type ShopSettings = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  profile: Record<string, unknown>;
  operatingMode: string;
  emergencyPaused: boolean;
  retentionDays: number;
  lastCleanupAt: string | null;
};

type CleanupPreview = {
  eligibleCount: number;
  eligibleBytes: number;
  excludedCount: number;
  excludedSample: { fileName: string; reason: string }[];
  retentionDays: number;
  previouslyCleared: number;
  lastCleanupAt: string | null;
};

export function SettingsClient({ shopId, publicUrl, qrDataUrl }: { shopId: string; publicUrl: string; qrDataUrl: string }) {
  const { toast } = useToast();
  const [shop, setShop] = useState<ShopSettings | null>(null);
  const [form, setForm] = useState({ name: "", description: "", address: "", phone: "", hours: "", instructions: "", orderPrefix: "PF", openNow: true, acceptOnlinePayments: true, acceptCounterPayments: true });
  const [saving, setSaving] = useState<string | null>(null);
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [cleanupAck, setCleanupAck] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{ clearedCount: number; clearedBytes: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/settings?shopId=${shopId}`);
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error?.message ?? "Failed to load settings");
      setShop(d.shop);
      const p = d.shop.profile ?? {};
      setForm({
        name: d.shop.name,
        description: d.shop.description ?? "",
        address: String(p.address ?? ""),
        phone: String(p.phone ?? ""),
        hours: String(p.hours ?? ""),
        instructions: String(p.instructions ?? ""),
        orderPrefix: String(p.orderPrefix ?? "PF"),
        openNow: p.openNow !== false,
        acceptOnlinePayments: p.acceptOnlinePayments !== false,
        acceptCounterPayments: p.acceptCounterPayments !== false,
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load settings", "danger");
    }
  }, [shopId, toast]);

  const loadPreview = useCallback(async () => {
    setPreviewBusy(true);
    try {
      const res = await fetch("/api/admin/cleanup");
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error?.message ?? "Failed to preview cleanup");
      setPreview(d.preview);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to preview cleanup", "danger");
    } finally {
      setPreviewBusy(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
    void loadPreview();
  }, [load, loadPreview]);

  const patch = async (key: string, body: Record<string, unknown>, msg: string) => {
    setSaving(key);
    try {
      const res = await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error?.message ?? "Save failed");
      toast(msg, "success");
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed", "danger");
    } finally {
      setSaving(null);
    }
  };

  const saveProfile = () => {
    void patch("profile", {
      name: form.name,
      description: form.description,
      profile: { address: form.address, phone: form.phone, hours: form.hours, instructions: form.instructions, orderPrefix: form.orderPrefix, openNow: form.openNow, acceptOnlinePayments: form.acceptOnlinePayments, acceptCounterPayments: form.acceptCounterPayments },
    }, "Shop profile saved");
  };

  const runCleanup = async () => {
    setCleanupBusy(true);
    try {
      const res = await fetch("/api/admin/cleanup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error?.message ?? "Cleanup failed");
      setCleanupResult({ clearedCount: d.clearedCount, clearedBytes: d.clearedBytes });
      toast(`Cleared ${d.clearedCount} file(s) — order history preserved`, "success");
      setConfirmCleanup(false);
      setCleanupAck(false);
      void loadPreview();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Cleanup failed", "danger");
    } finally {
      setCleanupBusy(false);
    }
  };

  if (!shop) return <div className="p-10 grid place-items-center text-muted"><Spinner size={26} /></div>;

  const Toggle = ({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) => (
    <button type="button" onClick={() => onChange(!value)} className="w-full flex items-center gap-3 text-left px-3.5 py-3 rounded-[var(--radius-control)] border border-line hover:border-line-strong transition-colors" aria-pressed={value}>
      <span className={`w-9 h-5 rounded-full p-0.5 transition-colors shrink-0 ${value ? "bg-accent" : "bg-[var(--track)]"}`}>
        <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${value ? "translate-x-4" : ""}`} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold">{label}</span>
        <span className="block text-[12px] text-faint">{hint}</span>
      </span>
    </button>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted text-sm mt-0.5">Shop profile, customer QR, operating rules, and storage privacy.</p>
      </div>

      {/* QR + public link */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card p-6 flex flex-col items-center text-center">
          <h2 className="font-display font-bold self-start mb-3 flex items-center gap-2"><Icon name="qr" size={18} /> Customer QR code</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} alt={`QR code linking to ${publicUrl}`} className="w-44 h-44 rounded-[var(--radius-card)] border border-line" />
          <p className="text-[13px] text-muted mt-3">Customers scan this to upload and order prints at <strong className="text-fg">{shop.name}</strong>.</p>
          <div className="flex items-center gap-3 mt-3">
            <CopyButton text={publicUrl} label="Copy link" />
            <a href={qrDataUrl} download={`printflow-${shop.slug}-qr.png`} className="text-[13px] font-semibold text-muted hover:text-fg inline-flex items-center gap-1.5">
              <Icon name="upload" size={14} className="rotate-180" /> Download PNG
            </a>
          </div>
          <a href={publicUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-bold text-accent hover:underline">
            Open storefront <Icon name="external" size={14} />
          </a>
        </div>

        {/* Operating mode */}
        <div className="card p-6 lg:col-span-2 space-y-5">
          <div>
            <h2 className="font-display font-bold">Operating mode</h2>
            <p className="text-[13px] text-muted mt-1">Controls how paid orders reach the print queue. Mode changes never make unpaid jobs printable.</p>
            <div className="mt-3">
              <Segmented
                value={shop.operatingMode as "manual" | "auto" | "hybrid"}
                onChange={(v) => void patch("mode", { operatingMode: v }, `Operating mode set to ${v}`)}
                options={[
                  { value: "auto", label: "Automatic" },
                  { value: "hybrid", label: "Hybrid review" },
                  { value: "manual", label: "Manual" },
                ]}
              />
            </div>
            <p className="text-[12.5px] text-faint mt-2">
              {shop.operatingMode === "auto" && "Paid orders go straight to the agent queue."}
              {shop.operatingMode === "hybrid" && "Paid orders wait for staff approval before entering the queue."}
              {shop.operatingMode === "manual" && "Staff must explicitly release every paid order to the queue."}
            </p>
          </div>

          <div className="pt-4 border-t border-line">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-sm flex items-center gap-2">Emergency pause {shop.emergencyPaused && <Badge tone="danger">Active</Badge>}</h3>
                <p className="text-[12.5px] text-muted mt-0.5">Stops agents from claiming any new job immediately. Jobs already in the spooler finish safely.</p>
              </div>
              <Button
                variant={shop.emergencyPaused ? "primary" : "danger"}
                icon={shop.emergencyPaused ? "play" : "pauseCircle"}
                loading={saving === "pause"}
                onClick={() => void patch("pause", { emergencyPaused: !shop.emergencyPaused }, shop.emergencyPaused ? "Emergency pause released" : "Emergency pause engaged — no new claims")}
              >
                {shop.emergencyPaused ? "Resume printing" : "Engage pause"}
              </Button>
            </div>
          </div>

          <div className="pt-4 border-t border-line">
            <h3 className="font-bold text-sm">File retention</h3>
            <p className="text-[12.5px] text-muted mt-0.5">Minimum days before completed files become eligible for Clear Memory. 0 = eligible immediately after completion.</p>
            <div className="flex items-center gap-2 mt-2">
              <input type="number" min={0} max={365} className="input-base w-24" value={shop.retentionDays} onChange={(e) => setShop({ ...shop, retentionDays: Number(e.target.value) })} aria-label="Retention days" />
              <span className="text-sm text-muted">days</span>
              <Button size="sm" variant="secondary" loading={saving === "retention"} onClick={() => void patch("retention", { retentionDays: shop.retentionDays }, "Retention policy saved")}>Save</Button>
            </div>
          </div>
        </div>
      </div>

      {/* Shop profile */}
      <div className="card p-6">
        <h2 className="font-display font-bold mb-4">Shop profile &amp; storefront</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Shop name"><input className="input-base" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Order number prefix" hint={`Orders are numbered like ${form.orderPrefix || "PF"}-${"1042"}`}>
            <input className="input-base" value={form.orderPrefix} onChange={(e) => setForm({ ...form, orderPrefix: e.target.value.toUpperCase().slice(0, 5) })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description"><input className="input-base" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Short line shown on the storefront" /></Field>
          </div>
          <Field label="Address"><input className="input-base" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          <Field label="Phone"><input className="input-base" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Opening hours"><input className="input-base" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} placeholder="Mon–Sat, 9 AM – 8 PM" /></Field>
          <Field label="Order instructions" hint="Shown at the bottom of your storefront.">
            <input className="input-base" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
          </Field>
        </div>
        <div className="grid sm:grid-cols-3 gap-2.5 mt-4">
          <Toggle label="Open for orders" hint="Shows “Accepting orders” on the storefront" value={form.openNow} onChange={(v) => setForm({ ...form, openNow: v })} />
          <Toggle label="Online payments" hint="UPI, cards and wallets via the gateway" value={form.acceptOnlinePayments} onChange={(v) => setForm({ ...form, acceptOnlinePayments: v })} />
          <Toggle label="Pay at counter" hint="Customer pays on pickup" value={form.acceptCounterPayments} onChange={(v) => setForm({ ...form, acceptCounterPayments: v })} />
        </div>
        <div className="mt-5"><Button variant="primary" icon="check" loading={saving === "profile"} onClick={saveProfile}>Save profile</Button></div>
      </div>

      {/* Storage & privacy — Clear Memory */}
      <div className="card p-6 border-accent/25">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-[12px] bg-accent/12 text-accent grid place-items-center shrink-0"><Icon name="shield" size={19} /></span>
          <div>
            <h2 className="font-display font-bold">Storage &amp; privacy — Clear Memory</h2>
            <p className="text-[13px] text-muted mt-1">
              Permanently removes uploaded file bytes for <strong className="text-fg">safely completed</strong> work only. Order history, receipts, pricing,
              payment records and filenames are always preserved. Pending, unpaid, queued, paused, or approval-blocked work is protected automatically.
            </p>
          </div>
        </div>

        {!preview ? (
          <div className="py-8 grid place-items-center text-muted">{previewBusy ? <Spinner /> : null}</div>
        ) : (
          <div className="grid sm:grid-cols-3 gap-3 mt-5">
            <div className="bg-raised border border-line rounded-[var(--radius-card)] p-4">
              <p className="text-[12px] font-bold text-faint uppercase tracking-wide">Eligible to clear</p>
              <p className="font-display text-2xl font-bold mt-1">{preview.eligibleCount} files</p>
              <p className="text-[12.5px] text-muted">≈ {formatBytes(preview.eligibleBytes)}</p>
            </div>
            <div className="bg-raised border border-line rounded-[var(--radius-card)] p-4">
              <p className="text-[12px] font-bold text-faint uppercase tracking-wide">Protected</p>
              <p className="font-display text-2xl font-bold mt-1">{preview.excludedCount} files</p>
              <p className="text-[12.5px] text-muted">active, unpaid, or within retention</p>
            </div>
            <div className="bg-raised border border-line rounded-[var(--radius-card)] p-4">
              <p className="text-[12px] font-bold text-faint uppercase tracking-wide">Cleared so far</p>
              <p className="font-display text-2xl font-bold mt-1">{formatBytes(preview.previouslyCleared)}</p>
              <p className="text-[12.5px] text-muted">{preview.lastCleanupAt ? `last run ${timeAgo(preview.lastCleanupAt)}` : "never run"}</p>
            </div>
          </div>
        )}

        {preview && preview.excludedSample.length > 0 && (
          <details className="mt-3">
            <summary className="text-[13px] font-semibold text-accent cursor-pointer select-none">Why some files are protected ({preview.excludedCount})</summary>
            <ul className="mt-2 space-y-1 text-[12.5px] text-muted">
              {preview.excludedSample.map((x, i) => (
                <li key={i} className="flex justify-between gap-3"><span className="truncate">{x.fileName}</span><span className="text-faint shrink-0">{x.reason}</span></li>
              ))}
            </ul>
          </details>
        )}

        {cleanupResult && (
          <p className="mt-4 text-sm font-medium text-emerald-500 bg-emerald-500/8 border border-emerald-500/25 rounded-[var(--radius-control)] px-3 py-2.5">
            Last run cleared {cleanupResult.clearedCount} file(s) ≈ {formatBytes(cleanupResult.clearedBytes)}. File bytes are gone; all business records remain.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 mt-5">
          <Button variant="secondary" icon="refresh" loading={previewBusy} onClick={() => void loadPreview()}>Refresh preview</Button>
          <Button variant="danger" icon="trash" disabled={!preview || preview.eligibleCount === 0} onClick={() => setConfirmCleanup(true)}>
            Clear {preview?.eligibleCount ?? 0} eligible file{preview?.eligibleCount === 1 ? "" : "s"}
          </Button>
          <span className="text-[12px] text-faint">Scheduled auto-cleanup stays off — runs only when you click.</span>
        </div>
      </div>

      <Modal open={confirmCleanup} onClose={() => setConfirmCleanup(false)} title="Clear file contents?">
        <p className="text-sm text-muted">
          This permanently deletes the uploaded bytes of <strong className="text-fg">{preview?.eligibleCount}</strong> completed file(s)
          (≈ {formatBytes(preview?.eligibleBytes ?? 0)}). <strong className="text-fg">This cannot be undone.</strong>
        </p>
        <ul className="mt-3 space-y-1.5 text-[13px] text-muted">
          <li className="flex gap-2"><Icon name="check" size={15} className="text-emerald-500 mt-0.5" /> Orders, receipts, pricing snapshots and payment records stay.</li>
          <li className="flex gap-2"><Icon name="check" size={15} className="text-emerald-500 mt-0.5" /> Unpaid, queued, paused, printing and approval-pending work is untouched.</li>
          <li className="flex gap-2"><Icon name="check" size={15} className="text-emerald-500 mt-0.5" /> Tracking pages keep working and show “file securely cleared”.</li>
        </ul>
        <label className="flex items-start gap-2.5 mt-4 cursor-pointer">
          <input type="checkbox" checked={cleanupAck} onChange={(e) => setCleanupAck(e.target.checked)} className="mt-1 accent-[#42E8D1]" />
          <span className="text-[13px] text-muted">I understand that file deletion is irreversible and that estimated space savings may not reduce database size immediately.</span>
        </label>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={() => setConfirmCleanup(false)}>Keep files</Button>
          <Button variant="danger" disabled={!cleanupAck} loading={cleanupBusy} onClick={runCleanup}>Clear memory now</Button>
        </div>
      </Modal>
    </div>
  );
}
