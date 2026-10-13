"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Icon, ProgressBar } from "./ui";

type AgentInfo = { id: string; name: string; token: string; testMode: boolean; paused: boolean; version: string; hostname: string | null; os: string | null };
type PrinterInfo = { id: string; name: string; capabilities: Record<string, unknown> };
type LogLine = { t: string; level: "info" | "ok" | "warn" | "err"; msg: string };

const STAGE_DELAYS: Record<string, number> = {
  downloading: 700,
  validating: 650,
  preparing: 850,
  submitting: 600,
  submitted_to_spooler: 500,
};
const STAGE_LABELS: Record<string, string> = {
  downloading: "Downloading file",
  validating: "Validating document",
  preparing: "Preparing print data",
  submitting: "Submitting to printer",
  submitted_to_spooler: "Sent to print spooler",
};

export function SimulatorAgent({ agent, printers, onActivity }: { agent: AgentInfo; printers: PrinterInfo[]; onActivity?: () => void }) {
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [current, setCurrent] = useState<{ label: string; stage: string; pct: number } | null>(null);
  const [stats, setStats] = useState({ completed: 0, failed: 0 });
  const busyRef = useRef(false);
  const runningRef = useRef(false);
  const logBox = useRef<HTMLDivElement>(null);

  const log = useCallback((level: LogLine["level"], msg: string) => {
    const t = new Date().toLocaleTimeString();
    setLogs((l) => [...l.slice(-80), { t, level, msg }]);
    requestAnimationFrame(() => {
      if (logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight;
    });
  }, []);

  const headers = useCallback(
    () => ({ Authorization: `Bearer ${agent.token}`, "Content-Type": "application/json" }),
    [agent.token],
  );

  const heartbeat = useCallback(async () => {
    try {
      await fetch("/api/agent/heartbeat", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          version: "1.4.2-sim",
          hostname: "SIM-WIN11",
          os: "Windows 11 Pro (simulated)",
          currentJobId: null,
          diagnostics: { diskFreeGB: 84, tempWritable: true, spooler: "ok", pdfLib: "PyMuPDF 1.24 (sim)" },
          printers: printers.map((p) => ({ name: p.name, status: "online", capabilities: p.capabilities })),
        }),
      });
    } catch {
      log("warn", "Heartbeat failed — will retry");
    }
  }, [headers, printers, log]);

  const processJob = useCallback(
    async (jobId: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const claimRes = await fetch(`/api/agent/jobs/${jobId}/claim`, { method: "POST", headers: headers() });
        const claim = await claimRes.json();
        if (!claimRes.ok || !claim.ok) {
          if (claim?.error?.code === "SHOP_PAUSED") log("warn", "Claim rejected — emergency pause is active");
          else if (claim?.error?.code === "GATE_PAYMENT") log("warn", "Claim rejected — order is not paid (payment gate held)");
          else if (claim?.error?.code === "ALREADY_CLAIMED") log("warn", "Job already claimed by another agent");
          else log("warn", `Claim rejected: ${claim?.error?.message ?? "unknown"}`);
          return;
        }
        const job = claim.job as { label: string; testMode: boolean; config: Record<string, unknown> };
        const file = claim.file as { url: string; fileName: string; sizeBytes: number; checksum: string | null; needsConversion: boolean };
        const printer = (claim.printer as { name: string } | null)?.name ?? "no compatible printer";
        log("ok", `Claimed "${job.label}" → ${printer}${job.testMode ? " [test mode]" : ""}`);
        onActivity?.();

        const postStage = async (stage: string) => {
          setCurrent({ label: job.label, stage, pct: (Object.keys(STAGE_DELAYS).indexOf(stage) + 1) * 16 });
          await fetch(`/api/agent/jobs/${jobId}/progress`, {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ stage, eventId: `sim-${jobId}-${stage}` }),
          });
          await new Promise((r) => setTimeout(r, STAGE_DELAYS[stage] ?? 500));
        };

        await postStage("downloading");
        const dlRes = await fetch(file.url, { headers: { Authorization: `Bearer ${agent.token}` } });
        if (!dlRes.ok) {
          const code = (await dlRes.json().catch(() => null))?.error?.code;
          throw new Error(code === "FILE_CLEARED" ? "Source file was securely cleared" : `Download failed (${dlRes.status})`);
        }
        const buf = new Uint8Array(await dlRes.arrayBuffer());
        log("info", `Downloaded ${file.fileName} (${buf.length.toLocaleString()} bytes)`);

        await postStage("validating");
        if (file.checksum) {
          const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          if (digest !== file.checksum) throw new Error("Checksum mismatch — refusing to print corrupt download");
          log("info", "Checksum verified (SHA-256)");
        }
        if (file.needsConversion) log("warn", "Office file detected — conversion to PDF handled by shop pipeline");

        await postStage("preparing");
        const cfg = job.config ?? {};
        log("info", `Render settings: ${String(cfg.colorMode === "color" ? "colour" : "B&W")}, ${String(cfg.paperSize ?? "A4")}, ${String(cfg.duplex ?? "off") === "off" ? "simplex" : "duplex"}, ${Number(cfg.copies ?? 1)}×`);

        await postStage("submitting");
        await postStage("submitted_to_spooler");
        const spoolerRef = `SIM-${Date.now().toString(36).toUpperCase()}`;
        log("ok", `Submitted to Windows spooler (${spoolerRef})`);

        const resRes = await fetch(`/api/agent/jobs/${jobId}/result`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ status: "completed", spoolerRef, eventId: `sim-${jobId}-result` }),
        });
        const resData = await resRes.json();
        if (!resRes.ok || !resData.ok) throw new Error(resData?.error?.message ?? "Result rejected");
        setCurrent(null);
        setStats((s) => ({ ...s, completed: s.completed + 1 }));
        log("ok", `✓ "${job.label}" completed${agent.testMode ? " (simulated — nothing physically printed)" : ""}`);
        onActivity?.();
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Unknown simulator error";
        log("err", `Job failed: ${reason}`);
        setCurrent(null);
        setStats((s) => ({ ...s, failed: s.failed + 1 }));
        try {
          await fetch(`/api/agent/jobs/${jobId}/result`, {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ status: "failed", reason }),
          });
        } catch {
          /* best effort */
        }
        onActivity?.();
      } finally {
        busyRef.current = false;
      }
    },
    [headers, log, agent.testMode, onActivity],
  );

  const poll = useCallback(async () => {
    if (!runningRef.current || busyRef.current) return;
    try {
      const res = await fetch("/api/agent/jobs", { headers: headers() });
      const d = await res.json();
      if (!res.ok || !d.ok) {
        log("err", d?.error?.message ?? "Poll rejected — token may be revoked");
        setRunning(false);
        runningRef.current = false;
        return;
      }
      if (d.paused) {
        log("warn", `Queue paused: ${d.reason}`);
        return;
      }
      const jobs = d.jobs as { id: string; label: string; priority: number }[];
      if (jobs.length > 0) {
        log("info", `${jobs.length} job(s) available — claiming #${jobs[0].priority ?? 3} priority`);
        void processJob(jobs[0].id);
      }
    } catch {
      log("warn", "Network error during poll — backing off");
    }
  }, [headers, log, processJob]);

  useEffect(() => {
    runningRef.current = running;
    if (!running) return;
    log("ok", `Agent online — connected as "${agent.name}" (${agent.testMode ? "test mode" : "live mode"})`);
    void heartbeat();
    const hb = setInterval(() => void heartbeat(), 8000);
    const pl = setInterval(() => void poll(), 2500);
    void poll();
    return () => {
      clearInterval(hb);
      clearInterval(pl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  return (
    <div className="card overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-line">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`w-10 h-10 rounded-[12px] grid place-items-center ${running ? "bg-accent/12 text-accent" : "bg-surface2 text-muted"}`}>
            <Icon name="monitor" size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-sm flex items-center gap-2">
              Built-in simulator agent
              <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold ${running ? "text-emerald-500" : "text-faint"}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${running ? "bg-emerald-500 pulse-dot" : "bg-faint"}`} />
                {running ? (current ? "WORKING" : "WAITING FOR JOBS") : "STOPPED"}
              </span>
            </p>
            <p className="text-[12px] text-faint">Emulates the Windows Print Agent: poll → claim → download → validate → render → spool → report. No physical printer needed.</p>
          </div>
          <div className="flex items-center gap-2">
            {agent.testMode && <Badge tone="warning">Test mode</Badge>}
            <Button variant={running ? "danger" : "primary"} size="sm" icon={running ? "pause" : "play"} onClick={() => setRunning((v) => !v)}>
              {running ? "Stop agent" : "Start agent"}
            </Button>
          </div>
        </div>

        {current && (
          <div className="mt-4 bg-raised border border-line rounded-[var(--radius-card)] p-3.5">
            <div className="flex items-center justify-between text-[13px] font-semibold">
              <span className="truncate">{current.label}</span>
              <span className="text-accent shrink-0 ml-3">{STAGE_LABELS[current.stage] ?? current.stage}…</span>
            </div>
            <div className="mt-2"><ProgressBar value={current.pct} /></div>
          </div>
        )}
      </div>

      <div ref={logBox} className="h-56 overflow-y-auto bg-[#0d100f] text-[12px] font-mono leading-relaxed p-4" role="log" aria-label="Agent activity log">
        {logs.length === 0 ? (
          <p className="text-[#5c6660]">Agent console. Press “Start agent” — it will poll the queue every 2.5 seconds and print eligible jobs.</p>
        ) : (
          logs.map((l, i) => (
            <p key={i} className={l.level === "ok" ? "text-[#42e8d1]" : l.level === "err" ? "text-red-400" : l.level === "warn" ? "text-amber-400" : "text-[#9aa39c]"}>
              <span className="text-[#5c6660]">{l.t}</span> {l.msg}
            </p>
          ))
        )}
      </div>

      <div className="px-4 sm:px-5 py-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-muted border-t border-line">
        <span className="inline-flex items-center gap-1.5"><Icon name="check" size={13} className="text-emerald-500" /> {stats.completed} completed</span>
        <span className="inline-flex items-center gap-1.5"><Icon name="alert" size={13} className="text-red-400" /> {stats.failed} failed</span>
        <span className="inline-flex items-center gap-1.5"><Icon name="printer" size={13} /> {printers.length} printer(s) reported</span>
        {agent.testMode && <span className="ml-auto text-amber-500 font-semibold">Simulation — real printing requires test mode OFF on a paired Windows PC</span>}
      </div>
    </div>
  );
}
