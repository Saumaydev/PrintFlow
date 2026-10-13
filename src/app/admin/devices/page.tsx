"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, CopyButton, EmptyState, Icon, Modal, Spinner, useToast } from "@/components/ui";
import { SimulatorAgent } from "@/components/simulator-agent";
import { PRINTER_STATUS, timeAgo } from "@/lib/utils";

type Printer = { id: string; name: string; isDefault: boolean; enabled: boolean; status: string; capabilities: { sizes?: string[]; color?: boolean; duplex?: boolean }; lastSeenAt: string | null; lastTestAt: string | null; jobsPrinted: number };
type Agent = { id: string; name: string; token: string; tokenMasked: string; version: string; hostname: string | null; os: string | null; status: string; testMode: boolean; paused: boolean; lastHeartbeatAt: string | null; pairingCode: string | null; pairingCodeExpiresAt: string | null; revokedAt: string | null; currentJobId: string | null };

export default function DevicesPage() {
  const { toast } = useToast();
  const [printers, setPrinters] = useState<Printer[] | null>(null);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [pairing, setPairing] = useState<{ agent: string; code: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const [pr, ag] = await Promise.all([fetch("/api/admin/printers").then((r) => r.json()), fetch("/api/admin/agents").then((r) => r.json())]);
      if (pr.ok) setPrinters(pr.printers);
      if (ag.ok) setAgents(ag.agents);
    } catch {
      toast("Could not load devices", "danger");
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const agentAction = async (id: string, action: string, extra?: Record<string, unknown>) => {
    setBusy(id + action);
    try {
      const res = await fetch("/api/admin/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, ...extra }) });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error?.message ?? "Action failed");
      if (action === "pairing-code") setPairing({ agent: agents?.find((a) => a.id === id)?.name ?? "agent", code: d.pairingCode });
      if (action === "toggle-test") toast(`Test mode ${d.testMode ? "enabled" : "disabled"}`, "success");
      if (action === "toggle-pause") toast(d.paused ? "Agent paused — it will stop claiming new jobs" : "Agent resumed", "success");
      if (action === "rotate-token") toast("Token rotated — old agent connections stop on next request", "success");
      if (action === "revoke") toast("Agent revoked", "success");
      if (action === "reactivate") toast("Agent reactivated", "success");
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Action failed", "danger");
    } finally {
      setBusy(null);
    }
  };

  const printerAction = async (id: string, action: string, extra?: Record<string, unknown>) => {
    setBusy(id + action);
    try {
      const res = await fetch("/api/admin/printers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, ...extra }) });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error?.message ?? "Action failed");
      if (action === "test-print") toast("Test page queued — watch the simulator agent", "success");
      void load();
      if (action === "test-print") setRefreshKey((k) => k + 1);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Action failed", "danger");
    } finally {
      setBusy(null);
    }
  };

  const primaryAgent = agents?.find((a) => !a.revokedAt) ?? null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Printers &amp; Print Agent</h1>
        <p className="text-muted text-sm mt-0.5">Devices registered by the Windows Print Agent, plus the built-in simulator for hardware-free testing.</p>
      </div>

      {primaryAgent && printers && (
        <SimulatorAgent agent={primaryAgent} printers={printers.filter((p) => p.enabled)} onActivity={() => setRefreshKey((k) => k + 1)} />
      )}

      {/* Agents */}
      <section>
        <h2 className="font-display font-bold text-lg mb-3">Paired agents</h2>
        {!agents ? (
          <div className="p-8 grid place-items-center text-muted"><Spinner /></div>
        ) : agents.length === 0 ? (
          <div className="card"><EmptyState icon="monitor" title="No agents paired" /></div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {agents.map((a) => {
              const fresh = a.lastHeartbeatAt && Date.now() - new Date(a.lastHeartbeatAt).getTime() < 120000;
              const state = a.revokedAt ? "revoked" : a.paused ? "paused" : a.status === "never_connected" ? "never_connected" : fresh ? (a.currentJobId ? "working" : "connected") : "disconnected";
              const meta = { never_connected: { label: "Never connected", tone: "neutral" as const }, connected: { label: "Connected", tone: "success" as const }, working: { label: "Processing job", tone: "teal" as const }, disconnected: { label: "Disconnected", tone: "danger" as const }, paused: { label: "Paused", tone: "warning" as const }, revoked: { label: "Revoked", tone: "danger" as const } }[state];
              return (
                <div key={a.id} className={`card p-5 ${a.revokedAt ? "opacity-60" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-10 h-10 rounded-[12px] bg-surface2 border border-line grid place-items-center text-muted shrink-0"><Icon name="monitor" size={19} /></span>
                      <div className="min-w-0">
                        <p className="font-bold truncate">{a.name}</p>
                        <p className="text-[12px] text-faint truncate">{a.hostname ?? "unknown host"} · {a.os ?? "unknown OS"} · v{a.version}</p>
                      </div>
                    </div>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-4 text-[12.5px]">
                    <span className="text-faint">Heartbeat</span><span className="font-semibold text-right">{timeAgo(a.lastHeartbeatAt)}</span>
                    <span className="text-faint">Test mode</span><span className="font-semibold text-right">{a.testMode ? "ON (simulated)" : "OFF (live)"}</span>
                    <span className="text-faint">Token</span><span className="font-mono text-[11px] text-right truncate">{a.tokenMasked}</span>
                  </div>
                  {state === "disconnected" && (
                    <p className="mt-3 text-[12px] text-amber-500 bg-amber-500/8 border border-amber-500/25 rounded-[var(--radius-control)] px-2.5 py-1.5">
                      Last seen {timeAgo(a.lastHeartbeatAt)}. Check the shop PC is powered on and has internet access.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5 mt-4 pt-4 border-t border-line">
                    {!a.revokedAt ? (
                      <>
                        <Button size="sm" variant="secondary" icon="qr" loading={busy === a.id + "pairing-code"} onClick={() => void agentAction(a.id, "pairing-code")}>New pairing code</Button>
                        <Button size="sm" variant="secondary" icon={a.paused ? "play" : "pause"} loading={busy === a.id + "toggle-pause"} onClick={() => void agentAction(a.id, "toggle-pause")}>{a.paused ? "Resume" : "Pause"}</Button>
                        <Button size="sm" variant="secondary" icon="zap" loading={busy === a.id + "toggle-test"} onClick={() => void agentAction(a.id, "toggle-test")}>{a.testMode ? "Go live" : "Test mode"}</Button>
                        <Button size="sm" variant="secondary" icon="refresh" loading={busy === a.id + "rotate-token"} onClick={() => void agentAction(a.id, "rotate-token")}>Rotate token</Button>
                        <Button size="sm" variant="danger" icon="x" loading={busy === a.id + "revoke"} onClick={() => void agentAction(a.id, "revoke")}>Revoke</Button>
                      </>
                    ) : (
                      <Button size="sm" variant="secondary" icon="rotate" loading={busy === a.id + "reactivate"} onClick={() => void agentAction(a.id, "reactivate")}>Reactivate</Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Printers */}
      <section>
        <h2 className="font-display font-bold text-lg mb-3">Printers</h2>
        {!printers ? (
          <div className="p-8 grid place-items-center text-muted"><Spinner /></div>
        ) : printers.length === 0 ? (
          <div className="card"><EmptyState icon="printer" title="No printers yet" hint="Printers are registered automatically when the agent sends a heartbeat." /></div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {printers.map((p) => {
              const meta = PRINTER_STATUS[p.status] ?? { label: p.status, tone: "neutral" as const };
              const caps = p.capabilities ?? {};
              return (
                <div key={p.id} className={`card p-5 ${!p.enabled ? "opacity-60" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-10 h-10 rounded-[12px] bg-surface2 border border-line grid place-items-center text-muted shrink-0"><Icon name="printer" size={19} /></span>
                      <div className="min-w-0">
                        <p className="font-bold truncate">{p.name}</p>
                        <p className="text-[12px] text-faint">{p.jobsPrinted} jobs printed · seen {timeAgo(p.lastSeenAt)}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      {p.isDefault && <Badge tone="teal">Default</Badge>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-3.5">
                    {(caps.sizes ?? []).map((s) => <span key={s} className="px-2 py-0.5 rounded-md bg-raised border border-line text-[11px] font-bold text-muted">{s}</span>)}
                    <span className="px-2 py-0.5 rounded-md bg-raised border border-line text-[11px] font-bold text-muted">{caps.color ? "Colour" : "B&W only"}</span>
                    <span className="px-2 py-0.5 rounded-md bg-raised border border-line text-[11px] font-bold text-muted">{caps.duplex ? "Duplex" : "Simplex"}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-4 pt-4 border-t border-line">
                    {!p.isDefault && <Button size="sm" variant="secondary" icon="check" loading={busy === p.id + "default"} onClick={() => void printerAction(p.id, "default")}>Make default</Button>}
                    <Button size="sm" variant="primary" icon="printer" loading={busy === p.id + "test-print"} onClick={() => void printerAction(p.id, "test-print")}>Print test page</Button>
                    <Button size="sm" variant="secondary" loading={busy === p.id + "toggle-enabled"} onClick={() => void printerAction(p.id, "toggle-enabled")}>{p.enabled ? "Disable" : "Enable"}</Button>
                    {p.enabled && p.status !== "offline" && (
                      <Button size="sm" variant="ghost" loading={busy === p.id + "mark-status"} onClick={() => void printerAction(p.id, "mark-status", { status: "offline" })}>Mark offline</Button>
                    )}
                    {p.status === "offline" && (
                      <Button size="sm" variant="ghost" loading={busy === p.id + "mark-status"} onClick={() => void printerAction(p.id, "mark-status", { status: "online" })}>Mark online</Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Pairing modal */}
      <Modal open={pairing !== null} onClose={() => setPairing(null)} title={`Pairing code for ${pairing?.agent ?? ""}`}>
        <div className="text-center">
          <p className="font-display text-3xl font-bold tracking-[0.2em] bg-raised border border-line rounded-[var(--radius-card)] py-5">{pairing?.code}</p>
          <div className="flex justify-center mt-3"><CopyButton text={pairing?.code ?? ""} label="Copy code" /></div>
          <p className="text-[13px] text-muted mt-4 text-left">
            Enter this code in the PrintFlow Agent on the shop&apos;s Windows PC within <strong className="text-fg">30 minutes</strong>. The code is single-use.
            For the built-in simulator above, no pairing is needed — it uses the secure agent token directly.
          </p>
          <div className="mt-4 text-left bg-[#0d100f] rounded-[var(--radius-control)] p-3.5 font-mono text-[11.5px] text-[#9aa39c] overflow-x-auto">
            <p className="text-[#5c6660]"># Real Windows agent pairing example</p>
            <p>curl -X POST https://your-domain/api/agent/pair \</p>
            <p>&nbsp;&nbsp;-H &quot;Content-Type: application/json&quot; \</p>
            <p>&nbsp;&nbsp;-d &apos;{`{"code":"${pairing?.code ?? ""}"}`}&apos;</p>
          </div>
        </div>
        <div className="flex justify-end mt-5">
          <Button variant="primary" onClick={() => setPairing(null)}>Done</Button>
        </div>
      </Modal>
    </div>
  );
}
