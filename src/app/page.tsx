import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { shops } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { Icon } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getSessionUser();
  const allShops = await db.select().from(shops).orderBy(desc(shops.createdAt)).limit(24);

  return (
    <main className="min-h-screen bg-bg">
      <header className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-[10px] bg-accent text-onaccent flex items-center justify-center">
            <Icon name="printer" size={20} strokeWidth={2} />
          </span>
          <span className="font-display font-bold text-lg tracking-tight">PrintFlow</span>
        </div>
        <div className="flex items-center gap-2">
          {user ? (
            <Link href="/admin" className="inline-flex items-center gap-2 h-10 px-4 rounded-[var(--radius-control)] bg-accent text-onaccent text-sm font-semibold hover:bg-accent-hover transition-colors">
              Open dashboard <Icon name="arrowRight" size={16} />
            </Link>
          ) : (
            <>
              <Link href="/login" className="h-10 px-4 inline-flex items-center rounded-[var(--radius-control)] text-sm font-semibold text-muted hover:text-fg transition-colors">
                Sign in
              </Link>
              <Link href="/register" className="h-10 px-4 inline-flex items-center rounded-[var(--radius-control)] bg-accent text-onaccent text-sm font-semibold hover:bg-accent-hover transition-colors">
                Get started
              </Link>
            </>
          )}
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-5 pt-14 pb-10">
        <div className="max-w-2xl">
          <p className="inline-flex items-center gap-2 text-[13px] font-semibold text-accent bg-accent/10 border border-accent/25 rounded-full px-3 py-1 mb-5">
            <Icon name="zap" size={14} /> Print ordering, shop operations &amp; print execution — one platform
          </p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold leading-[1.08] tracking-tight">
            Print anything.
            <br />
            Pay online. <span className="text-accent">Track everything.</span>
          </h1>
          <p className="text-muted text-base sm:text-lg mt-4 max-w-xl">
            Scan a shop&apos;s QR code, upload your documents or photos, pick your print settings, see a transparent
            price, and pay online or at the counter. Shops run the whole queue from one panel.
          </p>
          <div className="flex flex-wrap gap-3 mt-7">
            {allShops[0] && (
              <Link
                href={`/s/${allShops[0].slug}/new`}
                className="inline-flex items-center gap-2 h-12 px-6 rounded-[var(--radius-control)] bg-accent text-onaccent font-semibold hover:bg-accent-hover transition-colors"
              >
                <Icon name="upload" size={18} /> Upload &amp; print now
              </Link>
            )}
            <Link
              href={user ? "/admin" : "/register"}
              className="inline-flex items-center gap-2 h-12 px-6 rounded-[var(--radius-control)] border border-line-strong font-semibold hover:bg-surface2 transition-colors"
            >
              {user ? "Open admin panel" : "Set up my print shop"} <Icon name="arrowRight" size={17} />
            </Link>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-5 pb-20">
        <h2 className="font-display font-bold text-lg mb-4">{allShops.length > 0 ? "Print shops on PrintFlow" : "Getting started"}</h2>
        {allShops.length === 0 ? (
          <div className="card p-8 max-w-xl">
            <div className="flex items-start gap-4">
              <span className="w-10 h-10 rounded-[10px] bg-surface2 border border-line flex items-center justify-center text-accent shrink-0">
                <Icon name="info" size={19} />
              </span>
              <div>
                <p className="font-semibold">No print shops are configured yet.</p>
                <p className="text-sm text-muted mt-1">
                  Create the first account to become the platform administrator, then set up your shop — you&apos;ll get a
                  QR code customers can scan to upload and order prints.
                </p>
                <Link href="/register" className="inline-flex items-center gap-2 mt-4 text-sm font-semibold text-accent hover:underline">
                  Create the first account <Icon name="arrowRight" size={15} />
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {allShops.map((s) => {
              const p = s.profile as Record<string, unknown>;
              return (
                <Link key={s.id} href={`/s/${s.slug}`} className="card p-5 hover:border-accent/50 transition-colors group">
                  <div className="flex items-center gap-3">
                    <span className="w-11 h-11 rounded-[12px] flex items-center justify-center font-display font-bold text-lg" style={{ background: `${s.accent}22`, color: s.accent }}>
                      {s.name.slice(0, 1)}
                    </span>
                    <div className="min-w-0">
                      <p className="font-bold truncate">{s.name}</p>
                      <p className="text-[13px] text-muted truncate">{String(p.hours ?? "See shop page")}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-4 text-[13px]">
                    <span className={`inline-flex items-center gap-1.5 font-semibold ${p.openNow ? "text-emerald-500" : "text-red-400"}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${p.openNow ? "bg-emerald-500" : "bg-red-500"}`} />
                      {p.openNow ? "Accepting orders" : "Closed"}
                    </span>
                    <span className="text-faint ml-auto group-hover:text-accent transition-colors inline-flex items-center gap-1">
                      Order <Icon name="arrowRight" size={14} />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <footer className="border-t border-line py-8">
        <div className="max-w-6xl mx-auto px-5 flex flex-wrap items-center justify-between gap-3 text-[13px] text-faint">
          <span>PrintFlow — self-service printing for modern shops</span>
          <span>PDF · Word · PowerPoint · Excel · Photos</span>
        </div>
      </footer>
    </main>
  );
}
