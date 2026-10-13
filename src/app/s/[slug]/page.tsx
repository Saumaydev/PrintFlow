import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { shops } from "@/db/schema";
import { getActivePricing } from "@/lib/pricing";
import { money } from "@/lib/utils";
import { Icon } from "@/components/ui";
import { ACCEPTED_SUMMARY } from "@/lib/files";

export const dynamic = "force-dynamic";

export default async function StorefrontPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [shop] = await db.select().from(shops).where(eq(shops.slug, slug)).limit(1);
  if (!shop) notFound();
  const profile = shop.profile as Record<string, unknown>;
  const { rules } = await getActivePricing(shop.id);

  const services = [
    { icon: "file", name: "B&W documents", detail: `${money(rules.bwPerPage, rules.currency)} per page · A4` },
    { icon: "image", name: "Colour prints", detail: `${money(rules.colorPerPage, rules.currency)} per page · A4` },
    { icon: "printer", name: "Office files", detail: "Word, PowerPoint & Excel converted to PDF" },
    { icon: "zap", name: "Urgent service", detail: `+${rules.urgentPct}% · jump the queue` },
    { icon: "orders", name: "Binding & finishing", detail: "Spiral, lamination, hardcover" },
    { icon: "shield", name: "Private by design", detail: "Files auto-cleared after completion" },
  ];

  return (
    <main className="min-h-screen bg-bg">
      <header className="max-w-5xl mx-auto px-5 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-[9px] bg-accent text-onaccent flex items-center justify-center">
            <Icon name="printer" size={17} strokeWidth={2} />
          </span>
          <span className="font-display font-bold">PrintFlow</span>
        </Link>
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <span className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-full border ${profile.openNow ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/8" : "text-red-400 border-red-500/30 bg-red-500/8"}`}>
            <span className={`w-1.5 h-1.5 rounded-full pulse-dot ${profile.openNow ? "bg-emerald-500" : "bg-red-500"}`} />
            {profile.openNow ? "Accepting orders" : "Currently closed"}
          </span>
        </div>
      </header>

      <section className="max-w-5xl mx-auto px-5 pt-10 pb-8">
        <div className="flex flex-col md:flex-row md:items-end gap-6 justify-between">
          <div>
            <div className="flex items-center gap-4">
              <span className="w-14 h-14 rounded-[16px] flex items-center justify-center font-display font-bold text-2xl shrink-0" style={{ background: `${shop.accent}22`, color: shop.accent }}>
                {shop.name.slice(0, 1)}
              </span>
              <div>
                <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight">{shop.name}</h1>
                <p className="text-muted mt-1">{shop.description || "Self-service printing — upload, pay, collect."}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 mt-5 text-[13px] text-muted">
              {String(profile.hours ?? "") && <span className="inline-flex items-center gap-1.5"><Icon name="clock" size={14} /> {String(profile.hours)}</span>}
              {String(profile.address ?? "") && <span className="inline-flex items-center gap-1.5"><Icon name="home" size={14} /> {String(profile.address)}</span>}
              {String(profile.phone ?? "") && <span className="inline-flex items-center gap-1.5"><Icon name="wifi" size={14} /> {String(profile.phone)}</span>}
            </div>
          </div>
          <div className="flex gap-3 shrink-0">
            <Link
              href={`/s/${shop.slug}/new`}
              className="inline-flex items-center gap-2 h-12 px-6 rounded-[var(--radius-control)] bg-accent text-onaccent font-semibold hover:bg-accent-hover transition-colors"
            >
              <Icon name="upload" size={18} /> Upload &amp; print
            </Link>
          </div>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-5 pb-10">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {services.map((s) => (
            <div key={s.name} className="card p-4 flex items-start gap-3">
              <span className="w-9 h-9 rounded-[10px] bg-accent/10 text-accent flex items-center justify-center shrink-0">
                <Icon name={s.icon} size={18} />
              </span>
              <div>
                <p className="font-bold text-sm">{s.name}</p>
                <p className="text-[13px] text-muted mt-0.5">{s.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-5 pb-16">
        <div className="card p-6 sm:p-8 bg-raised">
          <div className="grid md:grid-cols-3 gap-8">
            <div>
              <h2 className="font-display font-bold text-lg mb-3">How it works</h2>
              <ol className="space-y-2.5 text-sm text-muted">
                <li className="flex gap-2.5"><span className="text-accent font-bold">1.</span> Upload PDFs, photos, Word, PowerPoint or Excel files</li>
                <li className="flex gap-2.5"><span className="text-accent font-bold">2.</span> Pick copies, colour, duplex, paper &amp; finishing — see the exact price</li>
                <li className="flex gap-2.5"><span className="text-accent font-bold">3.</span> Pay online or at the counter, then track your order live</li>
              </ol>
            </div>
            <div>
              <h2 className="font-display font-bold text-lg mb-3">Accepted files</h2>
              <p className="text-sm text-muted">{ACCEPTED_SUMMARY}</p>
              <p className="text-[13px] text-faint mt-2">Office documents are converted to PDF by the shop before printing. Password-protected or corrupt files are rejected safely.</p>
            </div>
            <div>
              <h2 className="font-display font-bold text-lg mb-3">Payment</h2>
              <div className="space-y-2 text-sm text-muted">
                {profile.acceptOnlinePayments !== false && <p className="flex items-center gap-2"><Icon name="check" size={15} className="text-accent" /> Online payment (UPI / cards / wallets)</p>}
                {profile.acceptCounterPayments !== false && <p className="flex items-center gap-2"><Icon name="check" size={15} className="text-accent" /> Pay at counter on pickup</p>}
                <p className="flex items-center gap-2"><Icon name="check" size={15} className="text-accent" /> Transparent per-page pricing, GST included</p>
              </div>
            </div>
          </div>
          {String(profile.instructions ?? "") !== "" && (
            <p className="mt-6 pt-5 border-t border-line text-[13px] text-faint flex items-center gap-2">
              <Icon name="info" size={14} /> {String(profile.instructions)}
            </p>
          )}
        </div>
      </section>

      <footer className="border-t border-line py-6">
        <p className="max-w-5xl mx-auto px-5 text-[13px] text-faint">Powered by PrintFlow</p>
      </footer>
    </main>
  );
}
