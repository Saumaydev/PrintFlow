"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon, ThemeToggle } from "./ui";
import type { AdminShop } from "@/lib/admin-context";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: "grid", exact: true },
  { href: "/admin/orders", label: "Orders", icon: "orders" },
  { href: "/admin/queue", label: "Print queue", icon: "queue" },
  { href: "/admin/payments", label: "Payments", icon: "card" },
  { href: "/admin/pricing", label: "Pricing & services", icon: "tag" },
  { href: "/admin/devices", label: "Printers & agent", icon: "printer" },
  { href: "/admin/staff", label: "Staff & roles", icon: "users" },
  { href: "/admin/analytics", label: "Analytics", icon: "chart" },
  { href: "/admin/audit", label: "Audit log", icon: "shield" },
  { href: "/admin/settings", label: "Settings", icon: "settings" },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-3 px-3 h-10 rounded-[var(--radius-control)] text-sm font-semibold transition-colors ${
              active ? "bg-accent/12 text-accent" : "text-muted hover:text-fg hover:bg-surface2"
            }`}
            aria-current={active ? "page" : undefined}
          >
            <Icon name={item.icon} size={17} />
            {item.label}
            {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-accent" />}
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminShell({
  userName,
  userEmail,
  isPlatformAdmin,
  shops,
  activeShop,
  children,
}: {
  userName: string;
  userEmail: string;
  isPlatformAdmin: boolean;
  shops: AdminShop[];
  activeShop: AdminShop | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);

  const switchShop = (id: string) => {
    document.cookie = `pf_shop=${id};path=/;max-age=${60 * 60 * 24 * 365}`;
    router.refresh();
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  };

  const shopSwitcher = shops.length > 0 && (
    <div className="px-2 mb-3">
      <label className="block text-[11px] uppercase tracking-wide font-bold text-faint px-1 mb-1.5">Workspace</label>
      <select
        className="input-base text-sm font-semibold"
        value={activeShop?.id ?? ""}
        onChange={(e) => switchShop(e.target.value)}
        aria-label="Switch shop workspace"
      >
        {shops.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="min-h-screen bg-bg">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-60 flex-col border-r border-line bg-raised z-40">
        <div className="h-16 flex items-center gap-2.5 px-5 border-b border-line">
          <span className="w-8 h-8 rounded-[9px] bg-accent text-onaccent flex items-center justify-center">
            <Icon name="printer" size={18} strokeWidth={2} />
          </span>
          <span className="font-display font-bold text-[15px]">PrintFlow</span>
          {isPlatformAdmin && <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-accent bg-accent/12 border border-accent/25 rounded-full px-2 py-0.5">Admin</span>}
        </div>
        <div className="flex-1 overflow-y-auto py-4 px-3">
          {shopSwitcher}
          <NavItems />
        </div>
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-2.5 px-2 py-2">
            <span className="w-8 h-8 rounded-full bg-surface2 border border-line flex items-center justify-center text-[13px] font-bold text-accent">
              {userName.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold truncate">{userName}</p>
              <p className="text-[11px] text-faint truncate">{userEmail}</p>
            </div>
          </div>
          <div className="flex gap-1.5 mt-1">
            <ThemeToggle />
            <button onClick={logout} className="flex-1 h-9 px-3 rounded-[var(--radius-control)] border border-line text-[13px] font-semibold text-muted hover:text-fg hover:bg-surface2 transition-colors flex items-center justify-center gap-2">
              <Icon name="logout" size={15} /> Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-40 h-14 bg-raised/95 backdrop-blur border-b border-line flex items-center gap-3 px-4">
        <button onClick={() => setDrawer(true)} className="p-2 -ml-2 text-muted" aria-label="Open navigation menu">
          <Icon name="queue" size={20} />
        </button>
        <span className="font-display font-bold">PrintFlow</span>
        {activeShop && <span className="text-[13px] text-muted truncate">· {activeShop.name}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />
        </div>
      </header>

      {/* Mobile drawer */}
      {drawer && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-72 bg-raised border-r border-line flex flex-col animate-in">
            <div className="h-14 flex items-center justify-between px-4 border-b border-line">
              <span className="font-display font-bold">PrintFlow</span>
              <button onClick={() => setDrawer(false)} className="p-2 text-muted" aria-label="Close menu">
                <Icon name="x" size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-4 px-3">
              {shopSwitcher}
              <NavItems onNavigate={() => setDrawer(false)} />
            </div>
            <div className="border-t border-line p-3 flex gap-1.5">
              <button onClick={logout} className="flex-1 h-10 px-3 rounded-[var(--radius-control)] border border-line text-[13px] font-semibold text-muted hover:text-fg transition-colors flex items-center justify-center gap-2">
                <Icon name="logout" size={15} /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="lg:pl-60 min-h-screen">
        <div className="max-w-[1240px] mx-auto px-4 sm:px-6 py-6 sm:py-8">{children}</div>
      </main>
    </div>
  );
}
