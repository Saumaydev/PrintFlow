"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, EmptyState, Field, Icon, Modal, Spinner, useToast } from "@/components/ui";
import { formatDate } from "@/lib/utils";

type StaffRow = { id: string; name: string; email: string; role: string; active: boolean; createdAt: string };

const ROLE_INFO: Record<string, string> = {
  owner: "Full control incl. billing, staff and security",
  manager: "Pricing, settings, cleanup, staff and reports",
  operator: "Runs the queue, printers and reprints",
  counter: "Assists orders and records counter payments",
};

export default function StaffPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<StaffRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("counter");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/staff");
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error?.message ?? "Failed to load staff");
      setRows(d.staff);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load staff", "danger");
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, action: string, extra?: Record<string, unknown>) => {
    setBusy(id + action);
    try {
      const res = await fetch("/api/admin/staff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, ...extra }) });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error?.message ?? "Action failed");
      toast("Staff updated", "success");
      setInviteOpen(false);
      void load();
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
          <h1 className="font-display text-2xl font-bold tracking-tight">Staff &amp; roles</h1>
          <p className="text-muted text-sm mt-0.5">Role checks are enforced server-side on every API route.</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setInviteOpen(true)}>Add staff member</Button>
      </div>

      <div className="card overflow-hidden">
        {!rows ? (
          <div className="p-10 grid place-items-center text-muted"><Spinner /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon="users" title="No staff yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-wide text-faint border-b border-line">
                  <th className="px-4 py-3 font-bold">Member</th>
                  <th className="px-4 py-3 font-bold">Role</th>
                  <th className="px-4 py-3 font-bold">Permissions</th>
                  <th className="px-4 py-3 font-bold">Added</th>
                  <th className="px-4 py-3 font-bold">Status</th>
                  <th className="px-4 py-3 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-bold">{s.name}</p>
                      <p className="text-[12px] text-faint">{s.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      {s.role === "owner" ? (
                        <Badge tone="teal" className="capitalize">{s.role}</Badge>
                      ) : (
                        <select className="input-base h-8 w-auto text-[12.5px]" value={s.role} onChange={(e) => void act(s.id, "role", { role: e.target.value })} aria-label={`Role for ${s.name}`}>
                          {["manager", "operator", "counter"].map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[12.5px] text-muted max-w-56">{ROLE_INFO[s.role] ?? ""}</td>
                    <td className="px-4 py-3 text-muted">{formatDate(s.createdAt)}</td>
                    <td className="px-4 py-3"><Badge tone={s.active ? "success" : "neutral"}>{s.active ? "Active" : "Disabled"}</Badge></td>
                    <td className="px-4 py-3 text-right">
                      {s.role !== "owner" && (
                        s.active ? (
                          <Button size="sm" variant="secondary" loading={busy === s.id + "disable"} onClick={() => void act(s.id, "disable")}>Disable</Button>
                        ) : (
                          <Button size="sm" variant="secondary" loading={busy === s.id + "enable"} onClick={() => void act(s.id, "enable")}>Enable</Button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card p-5 mt-4">
        <h2 className="font-bold text-sm mb-3 flex items-center gap-2"><Icon name="shield" size={16} className="text-accent" /> Role matrix</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {Object.entries(ROLE_INFO).map(([role, desc]) => (
            <div key={role} className="bg-raised border border-line rounded-[var(--radius-control)] p-3.5">
              <p className="font-bold text-sm capitalize">{role}</p>
              <p className="text-[12px] text-muted mt-1">{desc}</p>
            </div>
          ))}
        </div>
      </div>

      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Add staff member">
        <p className="text-sm text-muted">The person must <strong className="text-fg">register a PrintFlow account first</strong> with this email. Then add them here with a role.</p>
        <div className="space-y-4 mt-4">
          <Field label="Their account email">
            <input className="input-base" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="colleague@shop.com" />
          </Field>
          <Field label="Role" hint={ROLE_INFO[inviteRole]}>
            <select className="input-base" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
              <option value="manager">manager</option>
              <option value="operator">operator</option>
              <option value="counter">counter</option>
            </select>
          </Field>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={() => setInviteOpen(false)}>Cancel</Button>
          <Button variant="primary" disabled={!inviteEmail.includes("@")} loading={busy === "addadd"} onClick={() => void act("add", "add", { email: inviteEmail, role: inviteRole })}>Add to shop</Button>
        </div>
      </Modal>
    </div>
  );
}
