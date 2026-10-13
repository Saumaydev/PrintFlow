"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Tone } from "@/lib/utils";

// ---------- Icons (inline outline SVG, lucide-style) ----------

const ICON_PATHS: Record<string, React.ReactNode> = {
  logo: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M9 12h7M9 16h7M9 8h3" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4m0 0 4 4m-4-4L8 8" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </>
  ),
  file: (
    <>
      <path d="M6 2h9l5 5v15H6z" />
      <path d="M14 2v6h6" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-4.5-4.5L7 20" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </>
  ),
  orders: (
    <>
      <path d="M8 2v4M16 2v4" />
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M3 10h18M9 16l2 2 4-4" />
    </>
  ),
  queue: (
    <>
      <path d="M3 6h18M3 12h12M3 18h6" />
      <path d="m17 15 3 3-3 3" />
    </>
  ),
  card: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20M6 15h4" />
    </>
  ),
  tag: (
    <>
      <path d="M3 3h8l10 10-8 8L3 11z" />
      <circle cx="8" cy="8" r="1.5" />
    </>
  ),
  printer: (
    <>
      <path d="M6 9V3h12v6" />
      <rect x="3" y="9" width="18" height="8" rx="1" />
      <path d="M6 14h12v7H6z" />
    </>
  ),
  monitor: (
    <>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3 3.4-5 6.5-5s5.7 2 6.5 5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M16 15c2.5.3 4.5 2 5.2 4.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2 4 5.5V11c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5.5z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  chart: (
    <>
      <path d="M3 3v18h18" />
      <path d="M8 16v-5M13 16V8M18 16v-8" />
    </>
  ),
  qr: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14h1M14 20h1M18 18h3v3h-3z" />
    </>
  ),
  check: <path d="m4 12.5 5.5 5.5L20 6.5" />,
  x: <path d="M5 5l14 14M19 5 5 19" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  trash: (
    <>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 14h10l1-14M9 7V4h6v3" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 3v6h-6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 1.8 20.2h20.4z" />
      <path d="M12 9.5v5M12 17.8v.2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.2v.2" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6M20 4 11 13" />
      <path d="M19 14v6H5V6h6" />
    </>
  ),
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  arrowRight: <path d="M4 12h16m0 0-6-6m6 6-6 6" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
    </>
  ),
  moon: <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11Z" />,
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </>
  ),
  play: <path d="M7 4.5v15l12-7.5z" />,
  pause: <path d="M7 4.5v15M17 4.5v15" />,
  zap: <path d="M13 2 4 14h6l-1 8 9-12h-6z" />,
  home: (
    <>
      <path d="m3 11 9-8 9 8" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M10 21v-6h4v6" />
    </>
  ),
  wifi: (
    <>
      <path d="M2 8.5a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16.5a5 5 0 0 1 6 0" />
      <path d="M12 20h.01" />
    </>
  ),
  pauseCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5v7M14 8.5v7" />
    </>
  ),
  rotate: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </>
  ),
};

export function Icon({ name, size = 18, className = "", strokeWidth = 1.8 }: { name: string; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      {ICON_PATHS[name] ?? <circle cx="12" cy="12" r="9" />}
    </svg>
  );
}

// ---------- Buttons ----------

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "outline" | "dark";

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  className = "",
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 font-semibold rounded-[var(--radius-control)] transition-all duration-[var(--motion-fast)] disabled:opacity-45 disabled:pointer-events-none select-none whitespace-nowrap";
  const sizes = {
    sm: "text-[13px] px-3 h-8",
    md: "text-sm px-4 h-10",
    lg: "text-[15px] px-6 h-12",
  };
  const variants: Record<BtnVariant, string> = {
    primary: "bg-accent text-onaccent hover:bg-accent-hover shadow-sm",
    secondary: "bg-surface2 text-fg border border-line hover:border-line-strong hover:bg-line/40",
    ghost: "text-muted hover:text-fg hover:bg-surface2",
    danger: "bg-red-500/90 text-white hover:bg-red-500",
    outline: "border border-line-strong text-fg hover:bg-surface2",
    dark: "bg-ink text-ivory hover:opacity-90 border border-ink",
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Spinner size={14} /> : icon ? <Icon name={icon} size={size === "sm" ? 15 : 17} /> : null}
      {children}
    </button>
  );
}

export function Spinner({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`animate-spin ${className}`} aria-label="Loading">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

// ---------- Badges ----------

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-faint/15 text-muted border-line",
  teal: "bg-accent/12 text-accent border-accent/30",
  success: "bg-emerald-500/12 text-emerald-500 border-emerald-500/30",
  warning: "bg-amber-500/12 text-amber-500 border-amber-500/30",
  danger: "bg-red-500/12 text-red-400 border-red-500/30",
  info: "bg-sky-500/12 text-sky-400 border-sky-500/30",
};

export function Badge({ tone = "neutral", children, className = "" }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11.5px] font-semibold leading-5 ${TONE_CLASSES[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function StatusDot({ tone }: { tone: Tone }) {
  const colors: Record<Tone, string> = {
    neutral: "bg-faint",
    teal: "bg-accent",
    success: "bg-emerald-500",
    warning: "bg-amber-500",
    danger: "bg-red-500",
    info: "bg-sky-500",
  };
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${colors[tone]}`} />;
}

// ---------- Empty / error states ----------

export function EmptyState({ icon = "file", title, hint, action }: { icon?: string; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      <div className="w-12 h-12 rounded-[var(--radius-card)] bg-surface2 border border-line flex items-center justify-center text-muted mb-4">
        <Icon name={icon} size={22} />
      </div>
      <p className="font-semibold text-fg">{title}</p>
      {hint && <p className="text-sm text-muted mt-1 max-w-sm">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---------- Modal ----------

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`relative card w-full ${wide ? "max-w-3xl" : "max-w-lg"} max-h-[92vh] overflow-y-auto rounded-b-none sm:rounded-b-[var(--radius-card)] animate-in`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line sticky top-0 bg-surface z-10">
          <h3 className="font-bold text-[15px]">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-surface2 text-muted" aria-label="Close dialog">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ---------- Toasts ----------

type Toast = { id: number; message: string; tone: Tone };
const ToastCtx = createContext<{ toast: (message: string, tone?: Tone) => void }>({ toast: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback((message: string, tone: Tone = "neutral") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-5 z-[70] flex flex-col gap-2 w-[calc(100%-2rem)] sm:w-auto sm:max-w-sm" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`card px-4 py-3 flex items-center gap-2.5 text-sm font-medium animate-in shadow-lg ${t.tone === "danger" ? "border-red-500/40" : t.tone === "success" ? "border-emerald-500/40" : ""}`}>
            <span className={t.tone === "danger" ? "text-red-400" : t.tone === "success" ? "text-emerald-500" : "text-accent"}>
              <Icon name={t.tone === "danger" ? "alert" : t.tone === "success" ? "check" : "info"} size={17} />
            </span>
            <span className="text-fg">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- Form primitives ----------

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-semibold text-muted mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-xs text-faint mt-1">{hint}</span>}
    </label>
  );
}

export function Segmented<T extends string>({ options, value, onChange, size = "md" }: { options: { value: T; label: string; disabled?: boolean }[]; value: T; onChange: (v: T) => void; size?: "sm" | "md" }) {
  return (
    <div className="inline-flex bg-raised border border-line rounded-[var(--radius-control)] p-0.5 gap-0.5 flex-wrap" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={`px-3 ${size === "sm" ? "h-7 text-xs" : "h-8 text-[13px]"} rounded-md font-semibold transition-colors disabled:opacity-40 ${
            value === o.value ? "bg-accent text-onaccent shadow-sm" : "text-muted hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Theme ----------

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as "dark" | "light") || "dark");
  }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("pf_theme", next);
  };
  return (
    <button
      onClick={toggle}
      className="p-2 rounded-[var(--radius-control)] border border-line bg-surface2 text-muted hover:text-fg transition-colors"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
    </button>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-fg transition-colors"
    >
      <Icon name={copied ? "check" : "copy"} size={14} className={copied ? "text-emerald-500" : ""} />
      {copied ? "Copied" : label}
    </button>
  );
}

export function ProgressBar({ value, tone = "teal" }: { value: number; tone?: "teal" | "ink" }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-[var(--track)] overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-300 ${tone === "teal" ? "bg-accent" : "bg-fg"}`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
