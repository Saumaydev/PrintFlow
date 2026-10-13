"use client";

import { useEffect, useState } from "react";
import { Badge, EmptyState, Icon, Spinner } from "@/components/ui";
import { formatDate } from "@/lib/utils";

type AuditEntry = { id: string; actor: string; action: string; entityType: string | null; summary: string | null; createdAt: string };

export default function AuditPage() {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/audit");
        const d = await res.json();
        if (d.ok) setRows(d.entries);
      } catch {
        setRows([]);
      }
    })();
  }, []);

  const filtered = rows?.filter((r) => !q || r.action.includes(q.toLowerCase()) || r.actor.includes(q.toLowerCase()) || (r.summary ?? "").toLowerCase().includes(q.toLowerCase())) ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Audit log</h1>
          <p className="text-muted text-sm mt-0.5">Sensitive actions with actor, timestamp, and change summary. Secrets are never logged.</p>
        </div>
        <div className="relative">
          <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input-base pl-9 w-60" placeholder="Filter actions…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter audit log" />
        </div>
      </div>

      <div className="card overflow-hidden">
        {!rows ? (
          <div className="p-10 grid place-items-center text-muted"><Spinner /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="shield" title="No audit entries" hint="Actions like pricing changes, pauses, payments, cleanups and agent management will appear here." />
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {filtered.map((e) => (
              <div key={e.id} className="px-4 sm:px-5 py-3 flex items-start gap-3">
                <span className="w-8 h-8 rounded-[9px] bg-surface2 border border-line grid place-items-center text-muted shrink-0 mt-0.5"><Icon name="shield" size={15} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-bold">{e.action}</span>
                    {e.summary && <span className="text-muted"> — {e.summary}</span>}
                  </p>
                  <p className="text-[12px] text-faint mt-0.5">{e.actor} · {formatDate(e.createdAt)}</p>
                </div>
                <Badge tone="neutral" className="hidden sm:inline-flex">{e.entityType ?? "—"}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
