import { randomBytes } from "node:crypto";

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("hex");
}

export function pairingCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  const buf = randomBytes(8);
  for (let i = 0; i < 8; i++) out += chars[buf[i] % chars.length];
  return out.slice(0, 4) + "-" + out.slice(4);
}

export function money(paise: number, currency = "INR"): string {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

export function formatDate(d: Date | string | null): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function timeAgo(d: Date | string | null): string {
  if (!d) return "never";
  const dt = typeof d === "string" ? new Date(d) : d;
  const s = Math.max(0, (Date.now() - dt.getTime()) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ---------- page ranges ----------

/** Parses "1-3, 5, 8-10" into a sorted unique list of 1-based page numbers. */
export function parsePageRange(input: string, maxPages: number): number[] {
  const text = input.trim();
  if (!text || text.toLowerCase() === "all") {
    return Array.from({ length: maxPages }, (_, i) => i + 1);
  }
  const out = new Set<number>();
  for (const part of text.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw new Error(`Invalid page range: "${p}"`);
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    if (a < 1 || b < a) throw new Error(`Invalid page range: "${p}"`);
    if (b > maxPages) throw new Error(`Page ${b} is out of range (document has ${maxPages} pages)`);
    for (let i = a; i <= b; i++) out.add(i);
  }
  if (out.size === 0) throw new Error("Page range selects no pages");
  return [...out].sort((x, y) => x - y);
}

export function formatBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

// ---------- status presentation ----------

export type Tone = "neutral" | "teal" | "success" | "warning" | "danger" | "info";

export const ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  received: { label: "Received", tone: "neutral" },
  awaiting_payment: { label: "Awaiting payment", tone: "warning" },
  waiting_approval: { label: "Waiting approval", tone: "info" },
  queued: { label: "Queued for print", tone: "teal" },
  printing: { label: "Printing", tone: "teal" },
  quality_check: { label: "Quality check", tone: "info" },
  ready: { label: "Ready for pickup", tone: "success" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "danger" },
  rejected: { label: "Rejected", tone: "danger" },
  failed: { label: "Failed", tone: "danger" },
};

export const JOB_STATUS: Record<string, { label: string; tone: Tone }> = {
  awaiting_payment: { label: "Awaiting payment", tone: "warning" },
  waiting_approval: { label: "Waiting approval", tone: "info" },
  queued: { label: "Queued", tone: "teal" },
  printing: { label: "Printing", tone: "teal" },
  paused: { label: "Paused", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

export const PAYMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "warning" },
  authorized: { label: "Authorized", tone: "info" },
  paid: { label: "Paid", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  refunded: { label: "Refunded", tone: "neutral" },
};

export const PRINTER_STATUS: Record<string, { label: string; tone: Tone }> = {
  online: { label: "Online", tone: "success" },
  offline: { label: "Offline", tone: "danger" },
  busy: { label: "Busy", tone: "warning" },
  attention: { label: "Attention needed", tone: "warning" },
  disabled: { label: "Disabled", tone: "neutral" },
  unknown: { label: "Unknown", tone: "neutral" },
};

export const AGENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  never_connected: { label: "Never connected", tone: "neutral" },
  connected: { label: "Connected", tone: "success" },
  disconnected: { label: "Disconnected", tone: "danger" },
  working: { label: "Processing job", tone: "teal" },
  paused: { label: "Paused", tone: "warning" },
  revoked: { label: "Revoked", tone: "danger" },
};

export const PROGRESS_STAGES: Record<string, string> = {
  claimed: "Claimed",
  downloading: "Downloading file",
  validating: "Validating document",
  preparing: "Preparing print data",
  submitting: "Submitting to printer",
  submitted_to_spooler: "Sent to print spooler",
  completed: "Completed",
  failed: "Failed",
};

export const ORDER_TIMELINE: { key: string; label: string }[] = [
  { key: "received", label: "Order received" },
  { key: "awaiting_payment", label: "Awaiting payment" },
  { key: "waiting_approval", label: "Waiting approval" },
  { key: "queued", label: "Queued for printing" },
  { key: "printing", label: "Printing" },
  { key: "ready", label: "Ready for pickup" },
  { key: "completed", label: "Completed" },
];

export function classifyJobStatus(status: string): Tone {
  return JOB_STATUS[status]?.tone ?? "neutral";
}
