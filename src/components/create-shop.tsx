"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Icon, useToast } from "./ui";

export function CreateShopCard() {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/admin/shops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error?.message ?? "Could not create shop");
      document.cookie = `pf_shop=${data.shop.id};path=/;max-age=${60 * 60 * 24 * 365}`;
      toast(`Shop "${data.shop.name}" created — pricing, agent and printers seeded`, "success");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not create shop", "danger");
      setBusy(false);
    }
  };

  return (
    <div className="card p-7 max-w-xl">
      <div className="flex items-center gap-3">
        <span className="w-11 h-11 rounded-[12px] bg-accent/12 text-accent grid place-items-center"><Icon name="home" size={21} /></span>
        <div>
          <h2 className="font-display font-bold text-lg">Set up your print shop</h2>
          <p className="text-sm text-muted">Creates your storefront, default pricing, a print agent, and printers.</p>
        </div>
      </div>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <Field label="Shop name">
          <input className="input-base" value={name} onChange={(e) => { setName(e.target.value); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-")); }} placeholder="Sunrise Print Hub" required minLength={2} />
        </Field>
        <Field label="Public link" hint={`Customers open /s/${slug || "your-shop"} or scan the QR you'll get in Settings.`}>
          <div className="flex items-center gap-0">
            <span className="input-base rounded-r-none border-r-0 text-muted w-auto shrink-0 text-sm">/s/</span>
            <input className="input-base rounded-l-none" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="your-shop" required pattern="[a-z0-9-]+" />
          </div>
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">Create shop</Button>
      </form>
    </div>
  );
}
