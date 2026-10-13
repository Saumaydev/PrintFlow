"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Field, Icon, Spinner, useToast } from "@/components/ui";
import { money } from "@/lib/utils";

type Rules = {
  currency: string;
  taxRate: number;
  bwPerPage: number;
  colorPerPage: number;
  sizeMultiplier: Record<string, number>;
  duplexFactor: number;
  minJobPaise: number;
  urgentPct: number;
  maxCopies: number;
  finishing: Record<string, { label: string; price: number }>;
};

export default function PricingPage() {
  const { toast } = useToast();
  const [rules, setRules] = useState<Rules | null>(null);
  const [version, setVersion] = useState(0);
  const [history, setHistory] = useState<{ version: number; changedBy: string | null; createdAt: string }[]>([]);
  const [saving, setSaving] = useState(false);
  // sample preview state
  const [sample, setSample] = useState({ pages: 10, copies: 1, color: false, duplex: false, size: "A4" });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/pricing");
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error?.message ?? "Failed to load pricing");
      setRules(d.rules);
      setVersion(d.version);
      setHistory(d.history ?? []);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load pricing", "danger");
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!rules) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/pricing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules }) });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error?.message ?? "Save failed");
      setVersion(d.version);
      toast(`Pricing published as version ${d.version} — existing orders keep their price snapshot`, "success");
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed", "danger");
    } finally {
      setSaving(false);
    }
  };

  if (!rules) return <div className="p-10 grid place-items-center text-muted"><Spinner size={26} /></div>;

  const rupees = (paise: number) => (paise / 100).toFixed(2);
  const toPaise = (v: string) => Math.round(parseFloat(v || "0") * 100);

  // Sample preview mirroring the server quote formula (per printed side).
  const sizeMul = rules.sizeMultiplier[sample.size] ?? 1;
  const rate = (sample.color ? rules.colorPerPage : rules.bwPerPage) * sizeMul;
  let base = rate * sample.pages * sample.copies;
  if (sample.duplex) base = Math.round(base * rules.duplexFactor);
  if (base < rules.minJobPaise) base = rules.minJobPaise;
  const tax = Math.round((base * rules.taxRate) / 100);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Pricing &amp; services</h1>
          <p className="text-muted text-sm mt-0.5">Prices are in {rules.currency} per printed side. Publishing creates a new version — confirmed orders are never recalculated.</p>
        </div>
        <Badge tone="teal">Current version: v{version}</Badge>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="card p-5">
            <h2 className="font-display font-bold mb-4">Per-page rates</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="B&W price per side (₹)">
                <input className="input-base" type="number" step="0.5" min="0" value={rupees(rules.bwPerPage)} onChange={(e) => setRules({ ...rules, bwPerPage: toPaise(e.target.value) })} />
              </Field>
              <Field label="Colour price per side (₹)">
                <input className="input-base" type="number" step="0.5" min="0" value={rupees(rules.colorPerPage)} onChange={(e) => setRules({ ...rules, colorPerPage: toPaise(e.target.value) })} />
              </Field>
              <Field label="GST / tax rate (%)">
                <input className="input-base" type="number" step="1" min="0" max="40" value={rules.taxRate} onChange={(e) => setRules({ ...rules, taxRate: Number(e.target.value) })} />
              </Field>
              <Field label="Minimum job charge (₹)">
                <input className="input-base" type="number" step="1" min="0" value={rupees(rules.minJobPaise)} onChange={(e) => setRules({ ...rules, minJobPaise: toPaise(e.target.value) })} />
              </Field>
              <Field label="Duplex saving factor" hint="1 = no saving · 0.9 = 10% cheaper double-sided">
                <input className="input-base" type="number" step="0.05" min="0.5" max="1" value={rules.duplexFactor} onChange={(e) => setRules({ ...rules, duplexFactor: Number(e.target.value) })} />
              </Field>
              <Field label="Urgent surcharge (%)">
                <input className="input-base" type="number" step="5" min="0" max="200" value={rules.urgentPct} onChange={(e) => setRules({ ...rules, urgentPct: Number(e.target.value) })} />
              </Field>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="font-display font-bold mb-1">Paper size multipliers</h2>
            <p className="text-[12.5px] text-muted mb-4">Applied on top of the per-side rate.</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {Object.keys(rules.sizeMultiplier).map((size) => (
                <Field key={size} label={size}>
                  <input className="input-base" type="number" step="0.05" min="0.1" value={rules.sizeMultiplier[size]} onChange={(e) => setRules({ ...rules, sizeMultiplier: { ...rules.sizeMultiplier, [size]: Number(e.target.value) } })} />
                </Field>
              ))}
            </div>
          </div>

          <div className="card p-5">
            <h2 className="font-display font-bold mb-4">Finishing services</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {Object.entries(rules.finishing).map(([key, f]) => (
                <div key={key} className="flex items-center gap-2">
                  <input className="input-base flex-1" value={f.label} onChange={(e) => setRules({ ...rules, finishing: { ...rules.finishing, [key]: { ...f, label: e.target.value } } })} aria-label={`${key} label`} />
                  <div className="relative w-28 shrink-0">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint text-sm">₹</span>
                    <input className="input-base pl-6" type="number" step="1" min="0" value={rupees(f.price)} onChange={(e) => setRules({ ...rules, finishing: { ...rules.finishing, [key]: { ...f, price: toPaise(e.target.value) } } })} aria-label={`${key} price`} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="primary" size="lg" icon="check" loading={saving} onClick={save}>Publish new pricing version</Button>
            <Button variant="secondary" size="lg" onClick={() => void load()}>Discard changes</Button>
          </div>
        </div>

        {/* Live sample preview */}
        <aside className="space-y-4">
          <div className="card p-5">
            <h2 className="font-display font-bold mb-1 flex items-center gap-2"><Icon name="chart" size={17} /> Sample quote preview</h2>
            <p className="text-[12.5px] text-muted mb-4">Uses the unpublished draft values — safe to experiment.</p>
            <div className="space-y-3">
              <Field label="Pages">
                <input className="input-base" type="number" min="1" max="500" value={sample.pages} onChange={(e) => setSample({ ...sample, pages: Math.max(1, Number(e.target.value)) })} />
              </Field>
              <Field label="Copies">
                <input className="input-base" type="number" min="1" max={rules.maxCopies} value={sample.copies} onChange={(e) => setSample({ ...sample, copies: Math.max(1, Number(e.target.value)) })} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setSample({ ...sample, color: false })} className={`h-9 rounded-[var(--radius-control)] border text-[13px] font-bold transition-colors ${!sample.color ? "bg-accent text-onaccent border-accent" : "border-line text-muted"}`}>B&amp;W</button>
                <button type="button" onClick={() => setSample({ ...sample, color: true })} className={`h-9 rounded-[var(--radius-control)] border text-[13px] font-bold transition-colors ${sample.color ? "bg-accent text-onaccent border-accent" : "border-line text-muted"}`}>Colour</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select className="input-base" value={sample.size} onChange={(e) => setSample({ ...sample, size: e.target.value })} aria-label="Paper size">
                  {Object.keys(rules.sizeMultiplier).map((s) => <option key={s}>{s}</option>)}
                </select>
                <button type="button" onClick={() => setSample({ ...sample, duplex: !sample.duplex })} className={`h-9 rounded-[var(--radius-control)] border text-[13px] font-bold transition-colors ${sample.duplex ? "bg-accent text-onaccent border-accent" : "border-line text-muted"}`} aria-pressed={sample.duplex}>
                  Duplex {sample.duplex ? "on" : "off"}
                </button>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-line space-y-1.5 text-sm">
              <div className="flex justify-between text-muted"><span>Print ({sample.pages} sides × {sample.copies})</span><span className="tabular-nums">{money(rate * sample.pages * sample.copies, rules.currency)}</span></div>
              {sample.duplex && <div className="flex justify-between text-emerald-500"><span>Duplex saving</span><span className="tabular-nums">−{money(Math.round(rate * sample.pages * sample.copies * (1 - rules.duplexFactor)), rules.currency)}</span></div>}
              {base === rules.minJobPaise && <div className="flex justify-between text-muted"><span>Minimum charge applied</span><Icon name="check" size={14} className="text-accent" /></div>}
              <div className="flex justify-between text-muted"><span>Tax ({rules.taxRate}%)</span><span className="tabular-nums">{money(tax, rules.currency)}</span></div>
              <div className="flex justify-between items-baseline pt-1.5"><span className="font-bold">Estimated total</span><span className="font-display font-bold text-xl text-accent tabular-nums">{money(base + tax, rules.currency)}</span></div>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="font-display font-bold mb-3">Version history</h2>
            {history.length === 0 ? (
              <p className="text-sm text-muted">No versions yet.</p>
            ) : (
              <ol className="space-y-2 text-[13px]">
                {history.map((h) => (
                  <li key={h.version} className="flex items-center justify-between gap-2">
                    <span className="font-bold">v{h.version}{h.version === version && <Badge tone="teal" className="ml-2">active</Badge>}</span>
                    <span className="text-faint">{h.changedBy ?? "system"}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
