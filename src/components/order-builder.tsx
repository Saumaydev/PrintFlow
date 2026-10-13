"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Badge, Button, Field, Icon, Modal, ProgressBar, Segmented, useToast } from "./ui";
import { money, formatBytes, randomToken } from "@/lib/utils";

type FileConfig = {
  copies: number;
  colorMode: "bw" | "color";
  paperSize: string;
  duplex: "off" | "long" | "short";
  pagesPerSheet: number;
  pageRange: string;
  finishing: string[];
  urgent: boolean;
};

type UploadItem = {
  key: string;
  documentId: string | null;
  fileName: string;
  sizeBytes: number;
  kind: string;
  pageCount: number | null;
  needsConversion: boolean;
  status: "uploading" | "ready" | "error";
  error: string | null;
  previewUrl: string | null;
  config: FileConfig;
};

type QuoteData = {
  lines: { documentId: string; label: string; printablePages: number; faces: number; sheets: number; copies: number; base: number; finishing: { name: string; amount: number }[]; urgentFee: number; lineTotal: number; note?: string }[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  currency: string;
  pricingVersion: number;
  warnings: string[];
};

const DEFAULT_CONFIG: FileConfig = { copies: 1, colorMode: "bw", paperSize: "A4", duplex: "off", pagesPerSheet: 1, pageRange: "all", finishing: [], urgent: false };
const PAPER_SIZES = ["A4", "A5", "A3", "Letter", "Legal"];
const ACCEPT_ATTR = ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt";

export function OrderBuilder({ shop, }: { shop: { id: string; slug: string; name: string; acceptOnline: boolean; acceptCounter: boolean } }) {
  const { toast } = useToast();
  const [files, setFiles] = useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [finishingOptions, setFinishingOptions] = useState<Record<string, { label: string; price: number }>>({});
  const [customer, setCustomer] = useState({ name: "", phone: "", email: "", note: "" });
  const [paymentMethod, setPaymentMethod] = useState<"online" | "counter">(shop.acceptOnline ? "online" : "counter");
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState<{ orderNumber: string; token: string; total: number; currency: string; paymentMethod: string; paid: boolean } | null>(null);
  const [payModal, setPayModal] = useState<{ open: boolean; amount: number; currency: string; paymentId: string | null; mode: string; sessionId: string | null; busy: boolean; done: boolean }>({ open: false, amount: 0, currency: "INR", paymentId: null, mode: "", sessionId: null, busy: false, done: false });
  const idempotencyKey = useRef(randomToken(12));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const readyFiles = useMemo(() => files.filter((f) => f.status === "ready" && f.documentId), [files]);

  // ---------- upload ----------

  const uploadFile = useCallback(
    async (file: File) => {
      const key = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      const item: UploadItem = { key, documentId: null, fileName: file.name, sizeBytes: file.size, kind: "other", pageCount: null, needsConversion: false, status: "uploading", error: null, previewUrl, config: { ...DEFAULT_CONFIG } };
      setFiles((f) => [...f, item]);
      try {
        const fd = new FormData();
        fd.append("shopId", shop.id);
        fd.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data?.error?.message ?? "Upload failed");
        const d = data.document;
        setFiles((f) => f.map((x) => (x.key === key ? { ...x, documentId: d.id, kind: d.kind, pageCount: d.pageCount, needsConversion: d.needsConversion, status: "ready" } : x)));
      } catch (err) {
        setFiles((f) => f.map((x) => (x.key === key ? { ...x, status: "error", error: err instanceof Error ? err.message : "Upload failed" } : x)));
        toast(`Upload failed: ${file.name}`, "danger");
      }
    },
    [shop.id, toast],
  );

  const onFilesSelected = (list: FileList | File[]) => {
    Array.from(list).forEach((f) => void uploadFile(f));
  };

  const removeFile = (key: string) => {
    setFiles((f) => {
      const target = f.find((x) => x.key === key);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return f.filter((x) => x.key !== key);
    });
  };

  const retryFile = (item: UploadItem) => {
    // re-request requires the File; simplest is asking user to pick again
    removeFile(item.key);
    fileInputRef.current?.click();
  };

  const updateConfig = (key: string, patch: Partial<FileConfig>) => {
    setFiles((f) => f.map((x) => (x.key === key ? { ...x, config: { ...x.config, ...patch } } : x)));
  };

  // ---------- quoting (debounced, stale-request-safe) ----------

  useEffect(() => {
    if (quoteTimer.current) clearTimeout(quoteTimer.current);
    if (readyFiles.length === 0) {
      setQuote(null);
      return;
    }
    setQuoteBusy(true);
    quoteTimer.current = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch("/api/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shopId: shop.id, items: readyFiles.map((f) => ({ documentId: f.documentId, label: f.fileName, config: f.config })) }),
          signal: ctrl.signal,
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data?.error?.message ?? "Quote failed");
        setQuote(data.quote);
        setFinishingOptions(data.rules?.finishing ?? {});
        setQuoteError(null);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setQuoteError(err instanceof Error ? err.message : "Could not calculate price");
      } finally {
        if (!ctrl.signal.aborted) setQuoteBusy(false);
      }
    }, 550);
    return () => {
      if (quoteTimer.current) clearTimeout(quoteTimer.current);
    };
  }, [readyFiles, shop.id]);

  // ---------- place order ----------

  const placeOrder = async () => {
    if (customer.name.trim().length < 2) {
      toast("Please enter your name so the shop can identify your order.", "warning");
      return;
    }
    if (!quote || quote.total <= 0) return;
    setPlacing(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopId: shop.id,
          customerName: customer.name.trim(),
          phone: customer.phone.trim(),
          email: customer.email.trim(),
          note: customer.note.trim(),
          paymentMethod,
          idempotencyKey: idempotencyKey.current,
          items: readyFiles.map((f) => ({ documentId: f.documentId, label: f.fileName, config: f.config })),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error?.message ?? "Could not place order");
      const o = data.order;
      setPlaced({ orderNumber: o.orderNumber, token: o.token, total: o.total, currency: o.currency, paymentMethod: o.paymentMethod, paid: false });
      toast(`Order ${o.orderNumber} placed`, "success");
      if (o.paymentMethod === "online") {
        setTimeout(() => void startPayment(o.token, o.total, o.currency), 400);
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not place order", "danger");
    } finally {
      setPlacing(false);
    }
  };

  const startPayment = async (token: string, amount: number, currency: string) => {
    setPayModal({ open: true, amount, currency, paymentId: null, mode: "loading", sessionId: null, busy: true, done: false });
    try {
      const res = await fetch("/api/payments/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderToken: token }) });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error?.message ?? "Payment start failed");
      if (data.mode === "sandbox") setPayModal({ open: true, amount, currency, paymentId: data.paymentId, mode: "sandbox", sessionId: null, busy: false, done: false });
      else setPayModal({ open: true, amount, currency, paymentId: null, mode: "cashfree", sessionId: data.paymentSessionId, busy: false, done: false });
    } catch (err) {
      setPayModal({ open: false, amount, currency, paymentId: null, mode: "", sessionId: null, busy: false, done: false });
      toast(err instanceof Error ? err.message : "Payment start failed", "danger");
    }
  };

  const confirmSandboxPayment = async () => {
    if (!placed || !payModal.paymentId) return;
    setPayModal((m) => ({ ...m, busy: true }));
    try {
      const res = await fetch("/api/payments/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderToken: placed.token, paymentId: payModal.paymentId }) });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error?.message ?? "Payment confirmation failed");
      setPayModal((m) => ({ ...m, busy: false, done: true }));
      setPlaced((p) => (p ? { ...p, paid: true } : p));
      toast("Payment received — thank you!", "success");
    } catch (err) {
      setPayModal((m) => ({ ...m, busy: false }));
      toast(err instanceof Error ? err.message : "Payment confirmation failed", "danger");
    }
  };

  // ---------- confirmation screen ----------

  if (placed) {
    return (
      <main className="min-h-screen bg-bg">
        <div className="max-w-xl mx-auto px-5 py-14">
          <div className="card p-7 sm:p-9 text-center animate-in">
            <span className={`w-14 h-14 mx-auto rounded-full flex items-center justify-center ${placed.paid ? "bg-emerald-500/12 text-emerald-500" : "bg-accent/12 text-accent"}`}>
              <Icon name={placed.paid ? "check" : "clock"} size={26} strokeWidth={2.2} />
            </span>
            <h1 className="font-display text-2xl font-bold mt-4">Order {placed.orderNumber}</h1>
            <p className="text-muted mt-2">
              {placed.paid
                ? "Payment confirmed. Your job is being prepared for the print queue."
                : placed.paymentMethod === "online"
                  ? "Complete the payment to release your order to the print queue."
                  : "Pay at the counter when you collect. The shop will process your order after payment."}
            </p>
            <div className="mt-5 flex items-center justify-center gap-2 text-2xl font-bold font-display">
              {money(placed.total, placed.currency)}
            </div>
            <div className="mt-7 grid gap-2.5">
              {!placed.paid && placed.paymentMethod === "online" && (
                <Button variant="primary" size="lg" onClick={() => void startPayment(placed.token, placed.total, placed.currency)}>
                  Pay {money(placed.total, placed.currency)} now
                </Button>
              )}
              <Link href={`/track/${placed.token}`} className="inline-flex items-center justify-center gap-2 h-12 px-6 rounded-[var(--radius-control)] border border-line-strong font-semibold hover:bg-surface2 transition-colors">
                <Icon name="eye" size={17} /> Track this order
              </Link>
              <Link href={`/s/${shop.slug}`} className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-[var(--radius-control)] text-muted hover:text-fg font-semibold transition-colors">
                Back to {shop.name}
              </Link>
            </div>
            <p className="text-[12px] text-faint mt-6">Keep the tracking link — it is your receipt. You do not need an account.</p>
          </div>
        </div>

        <Modal open={payModal.open} onClose={() => setPayModal((m) => ({ ...m, open: false }))} title={payModal.done ? "Payment complete" : "Secure payment"}>
          {payModal.mode === "loading" && (
            <div className="flex items-center gap-3 py-6 text-muted">
              <span className="animate-spin"><Icon name="refresh" size={20} /></span> Contacting payment gateway…
            </div>
          )}
          {payModal.mode === "sandbox" && !payModal.done && (
            <div>
              <div className="bg-raised border border-line rounded-[var(--radius-card)] p-5 text-center">
                <p className="text-[13px] text-muted">Amount payable</p>
                <p className="font-display text-3xl font-bold mt-1">{money(payModal.amount, payModal.currency)}</p>
                <Badge tone="warning" className="mt-3">Sandbox gateway</Badge>
                <p className="text-[12px] text-faint mt-2">No Cashfree keys are configured, so this shop uses the built-in test gateway. Add keys in production (see setup.txt).</p>
              </div>
              <Button variant="primary" size="lg" className="w-full mt-4" loading={payModal.busy} onClick={confirmSandboxPayment}>
                Simulate successful payment
              </Button>
            </div>
          )}
          {payModal.mode === "cashfree" && !payModal.done && (
            <div>
              <p className="text-sm text-muted">Cashfree session created. In production the Cashfree checkout opens here.</p>
              <p className="text-[12px] text-faint mt-2 break-all">Session: {payModal.sessionId}</p>
            </div>
          )}
          {payModal.done && (
            <div className="text-center py-4">
              <Icon name="check" size={34} className="text-emerald-500 mx-auto" />
              <p className="font-semibold mt-3">Your payment was confirmed.</p>
              <p className="text-sm text-muted mt-1">The print queue will pick up your order automatically.</p>
              <Link href={`/track/${placed.token}`} className="inline-flex mt-5 items-center gap-2 h-10 px-5 rounded-[var(--radius-control)] bg-accent text-onaccent font-semibold">
                Track order <Icon name="arrowRight" size={15} />
              </Link>
            </div>
          )}
        </Modal>
      </main>
    );
  }

  // ---------- builder screen ----------

  return (
    <main className="min-h-screen bg-bg pb-24 lg:pb-10">
      <header className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
        <Link href={`/s/${shop.slug}`} className="flex items-center gap-2 text-sm font-semibold text-muted hover:text-fg transition-colors">
          <Icon name="chevronLeft" size={16} /> {shop.name}
        </Link>
        <span className="text-[13px] text-faint hidden sm:block">Files are private and auto-cleared after completion</span>
      </header>

      <div className="max-w-6xl mx-auto px-5">
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">New print order</h1>
        <p className="text-muted text-sm mt-1">Upload files, choose print settings, and see your exact price before paying.</p>

        <div className="grid lg:grid-cols-[1fr_380px] gap-6 mt-6 items-start">
          <div className="space-y-4 min-w-0">
            {/* Upload zone */}
            <div
              className={`card p-6 border-dashed transition-colors cursor-pointer ${dragOver ? "border-accent bg-accent/5" : ""}`}
              style={{ borderStyle: "dashed" }}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); onFilesSelected(e.dataTransfer.files); }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInputRef.current?.click()}
              aria-label="Upload files"
            >
              <input ref={fileInputRef} type="file" multiple accept={ACCEPT_ATTR} className="hidden" onChange={(e) => { if (e.target.files) onFilesSelected(e.target.files); e.target.value = ""; }} />
              <div className="flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
                <span className="w-12 h-12 rounded-[14px] bg-accent/12 text-accent flex items-center justify-center shrink-0">
                  <Icon name="upload" size={24} />
                </span>
                <div>
                  <p className="font-bold">Drop files here or tap to browse</p>
                  <p className="text-[13px] text-muted mt-0.5">PDF · JPG · PNG · WebP · Word · PowerPoint · Excel · TXT — up to 25 MB each</p>
                </div>
              </div>
            </div>

            {files.length === 0 && (
              <div className="card">
                <div className="flex flex-col items-center text-center py-10 px-6">
                  <Icon name="file" size={26} className="text-faint" />
                  <p className="font-semibold mt-3">No documents yet</p>
                  <p className="text-sm text-muted mt-1">Add PDFs, photos or Office files to start your order.</p>
                </div>
              </div>
            )}

            {files.map((f) => (
              <div key={f.key} className="card p-4 sm:p-5 animate-in">
                <div className="flex items-start gap-3">
                  {f.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.previewUrl} alt={`Preview of ${f.fileName}`} className="w-12 h-12 rounded-lg object-cover border border-line shrink-0" />
                  ) : (
                    <span className={`w-12 h-12 rounded-lg border border-line flex items-center justify-center shrink-0 ${f.kind === "pdf" ? "text-red-400 bg-red-500/8" : f.kind === "office" ? "text-sky-400 bg-sky-500/8" : "text-muted bg-surface2"}`}>
                      <Icon name={f.kind === "image" ? "image" : "file"} size={20} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm truncate">{f.fileName}</p>
                    <p className="text-[12px] text-faint mt-0.5">
                      {formatBytes(f.sizeBytes)}
                      {f.pageCount ? ` · ${f.pageCount} page${f.pageCount > 1 ? "s" : ""}` : ""}
                    </p>
                    {f.status === "uploading" && (
                      <div className="mt-2 flex items-center gap-2 text-[12px] text-muted">
                        <span className="animate-spin"><Icon name="refresh" size={13} /></span> Uploading…
                        <div className="flex-1"><ProgressBar value={60} /></div>
                      </div>
                    )}
                    {f.status === "error" && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-[12px] font-medium text-red-400">{f.error}</span>
                        <Button size="sm" variant="secondary" icon="refresh" onClick={() => retryFile(f)}>Replace file</Button>
                      </div>
                    )}
                    {f.needsConversion && f.status === "ready" && (
                      <p className="mt-2 text-[12px] font-medium text-amber-500 bg-amber-500/8 border border-amber-500/25 rounded-md px-2 py-1 inline-flex items-center gap-1.5">
                        <Icon name="info" size={13} /> Office file — the shop converts it to PDF before printing (page count is estimated)
                      </p>
                    )}
                  </div>
                  {f.status !== "uploading" && (
                    <button onClick={() => removeFile(f.key)} className="p-2 rounded-md text-muted hover:text-red-400 hover:bg-red-500/8 transition-colors" aria-label={`Remove ${f.fileName}`}>
                      <Icon name="trash" size={16} />
                    </button>
                  )}
                </div>

                {f.status === "ready" && (
                  <div className="mt-4 pt-4 border-t border-line grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Field label="Copies">
                      <div className="flex items-center gap-1">
                        <button type="button" className="w-9 h-9 rounded-[var(--radius-control)] border border-line grid place-items-center hover:bg-surface2 disabled:opacity-40" onClick={() => updateConfig(f.key, { copies: Math.max(1, f.config.copies - 1) })} disabled={f.config.copies <= 1} aria-label="Decrease copies">
                          <Icon name="minus" size={14} />
                        </button>
                        <span className="flex-1 text-center font-bold text-sm tabular-nums">{f.config.copies}</span>
                        <button type="button" className="w-9 h-9 rounded-[var(--radius-control)] border border-line grid place-items-center hover:bg-surface2 disabled:opacity-40" onClick={() => updateConfig(f.key, { copies: Math.min(50, f.config.copies + 1) })} disabled={f.config.copies >= 50} aria-label="Increase copies">
                          <Icon name="plus" size={14} />
                        </button>
                      </div>
                    </Field>
                    <Field label="Colour">
                      <Segmented size="sm" value={f.config.colorMode} onChange={(v) => updateConfig(f.key, { colorMode: v })} options={[{ value: "bw", label: "B&W" }, { value: "color", label: "Colour" }]} />
                    </Field>
                    <Field label="Paper size">
                      <select className="input-base h-9 text-sm" value={f.config.paperSize} onChange={(e) => updateConfig(f.key, { paperSize: e.target.value })} aria-label="Paper size">
                        {PAPER_SIZES.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </Field>
                    {f.kind === "pdf" && f.pageCount ? (
                      <Field label="Page range" hint="e.g. 1-3, 5, 8-10">
                        <input className="input-base h-9 text-sm" value={f.config.pageRange} onChange={(e) => updateConfig(f.key, { pageRange: e.target.value })} placeholder="all" aria-label="Page range" />
                      </Field>
                    ) : (
                      <Field label="Orientation">
                        <select className="input-base h-9 text-sm" disabled value="auto" aria-label="Orientation">
                          <option value="auto">Auto</option>
                        </select>
                      </Field>
                    )}

                    <details className="col-span-2 sm:col-span-4 group">
                      <summary className="cursor-pointer select-none text-[13px] font-semibold text-accent inline-flex items-center gap-1.5 list-none">
                        <Icon name="chevronRight" size={14} className="group-open:rotate-90 transition-transform" /> Advanced settings
                      </summary>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                        <Field label="Two-sided">
                          <select className="input-base h-9 text-sm" value={f.config.duplex} onChange={(e) => updateConfig(f.key, { duplex: e.target.value as FileConfig["duplex"] })} aria-label="Duplex">
                            <option value="off">Single-sided</option>
                            <option value="long">Double-sided (long edge)</option>
                            <option value="short">Double-sided (short edge)</option>
                          </select>
                        </Field>
                        <Field label="Pages per sheet">
                          <select className="input-base h-9 text-sm" value={f.config.pagesPerSheet} onChange={(e) => updateConfig(f.key, { pagesPerSheet: Number(e.target.value) })} aria-label="Pages per sheet">
                            {[1, 2, 4, 6, 9].map((n) => <option key={n} value={n}>{n}-up</option>)}
                          </select>
                        </Field>
                        <Field label="Finishing">
                          <div className="flex flex-wrap gap-1.5">
                            {Object.entries(finishingOptions).map(([k, v]) => {
                              const active = f.config.finishing.includes(k);
                              return (
                                <button key={k} type="button" onClick={() => updateConfig(f.key, { finishing: active ? f.config.finishing.filter((x) => x !== k) : [...f.config.finishing, k] })} className={`px-2.5 h-8 rounded-full text-[12px] font-semibold border transition-colors ${active ? "bg-accent text-onaccent border-accent" : "border-line text-muted hover:text-fg"}`} aria-pressed={active}>
                                  {v.label}
                                </button>
                              );
                            })}
                          </div>
                        </Field>
                        <Field label="Urgent">
                          <button type="button" onClick={() => updateConfig(f.key, { urgent: !f.config.urgent })} className={`h-9 px-3 rounded-[var(--radius-control)] text-[13px] font-bold border inline-flex items-center gap-1.5 transition-colors ${f.config.urgent ? "bg-amber-500/15 border-amber-500/40 text-amber-500" : "border-line text-muted hover:text-fg"}`} aria-pressed={f.config.urgent}>
                            <Icon name="zap" size={14} /> {f.config.urgent ? "Urgent" : "Standard"}
                          </button>
                        </Field>
                      </div>
                    </details>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Sidebar: quote + checkout */}
          <aside className="lg:sticky lg:top-6 space-y-4">
            <div className="card p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-display font-bold">Price</h2>
                {quoteBusy && <span className="text-[12px] text-muted inline-flex items-center gap-1.5"><span className="animate-spin"><Icon name="refresh" size={12} /></span> Updating…</span>}
              </div>
              {quoteError && <p className="text-[13px] font-medium text-red-400 mt-3">{quoteError}</p>}
              {!quote && !quoteError && <p className="text-sm text-muted mt-3">Upload a document to see your price.</p>}
              {quote && (
                <div className="mt-3 space-y-2.5 text-sm">
                  {quote.lines.map((l) => (
                    <div key={l.documentId}>
                      <div className="flex justify-between gap-3">
                        <span className="text-muted truncate">{l.label}</span>
                        <span className="font-semibold tabular-nums">{money(l.lineTotal, quote.currency)}</span>
                      </div>
                      <p className="text-[11.5px] text-faint">
                        {l.printablePages} page{l.printablePages !== 1 ? "s" : ""} → {l.faces} side{l.faces !== 1 ? "s" : ""} · {l.sheets} sheet{l.sheets !== 1 ? "s" : ""} × {l.copies} cop{l.copies > 1 ? "ies" : "y"}
                        {l.note ? ` · ${l.note}` : ""}
                      </p>
                    </div>
                  ))}
                  <div className="border-t border-line pt-2.5 space-y-1.5">
                    <div className="flex justify-between text-muted"><span>Subtotal</span><span className="tabular-nums">{money(quote.subtotal, quote.currency)}</span></div>
                    <div className="flex justify-between text-muted"><span>GST ({quote.taxRate}%)</span><span className="tabular-nums">{money(quote.taxAmount, quote.currency)}</span></div>
                    <div className="flex justify-between items-baseline pt-1">
                      <span className="font-bold">Total</span>
                      <span className="font-display font-bold text-2xl text-accent tabular-nums">{money(quote.total, quote.currency)}</span>
                    </div>
                    <p className="text-[11px] text-faint">Pricing v{quote.pricingVersion} · server-verified quote</p>
                  </div>
                </div>
              )}
            </div>

            <div className="card p-5 space-y-4">
              <h2 className="font-display font-bold">Your details</h2>
              <Field label="Full name *">
                <input className="input-base" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} placeholder="Your name" autoComplete="name" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone">
                  <input className="input-base" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} placeholder="98765 43210" autoComplete="tel" inputMode="tel" />
                </Field>
                <Field label="Email">
                  <input className="input-base" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} placeholder="optional" autoComplete="email" inputMode="email" />
                </Field>
              </div>
              <Field label="Note for the shop">
                <input className="input-base" value={customer.note} onChange={(e) => setCustomer({ ...customer, note: e.target.value })} placeholder="e.g. staple top-left" />
              </Field>

              <div>
                <span className="block text-[13px] font-semibold text-muted mb-1.5">Payment</span>
                <div className="grid gap-2">
                  {shop.acceptOnline && (
                    <label className={`flex items-center gap-3 border rounded-[var(--radius-control)] px-3 py-2.5 cursor-pointer transition-colors ${paymentMethod === "online" ? "border-accent bg-accent/6" : "border-line hover:border-line-strong"}`}>
                      <input type="radio" name="pay" checked={paymentMethod === "online"} onChange={() => setPaymentMethod("online")} className="accent-[#42E8D1]" />
                      <span className="text-sm font-semibold">Pay online now</span>
                      <Icon name="card" size={16} className="ml-auto text-muted" />
                    </label>
                  )}
                  {shop.acceptCounter && (
                    <label className={`flex items-center gap-3 border rounded-[var(--radius-control)] px-3 py-2.5 cursor-pointer transition-colors ${paymentMethod === "counter" ? "border-accent bg-accent/6" : "border-line hover:border-line-strong"}`}>
                      <input type="radio" name="pay" checked={paymentMethod === "counter"} onChange={() => setPaymentMethod("counter")} className="accent-[#42E8D1]" />
                      <span className="text-sm font-semibold">Pay at counter</span>
                      <Icon name="home" size={16} className="ml-auto text-muted" />
                    </label>
                  )}
                </div>
              </div>

              <Button variant="primary" size="lg" className="w-full" disabled={readyFiles.length === 0 || !quote || quoteBusy} loading={placing} onClick={placeOrder}>
                {paymentMethod === "online" ? `Place order & pay ${quote ? money(quote.total, quote.currency) : ""}` : "Place order"}
              </Button>
              <p className="text-[11.5px] text-faint text-center">By placing an order you agree to the shop&apos;s print policy. Prices are calculated server-side.</p>
            </div>
          </aside>
        </div>
      </div>

      {/* Mobile sticky total bar */}
      {quote && files.length > 0 && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-raised/95 backdrop-blur border-t border-line px-5 py-3 flex items-center gap-4">
          <div>
            <p className="text-[11px] text-faint">Total</p>
            <p className="font-display font-bold text-lg leading-none tabular-nums">{money(quote.total, quote.currency)}</p>
          </div>
          <Button variant="primary" className="flex-1" disabled={readyFiles.length === 0 || quoteBusy} loading={placing} onClick={placeOrder}>
            {paymentMethod === "online" ? "Place & pay" : "Place order"}
          </Button>
        </div>
      )}
    </main>
  );
}
