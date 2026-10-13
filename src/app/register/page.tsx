"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Field, Icon } from "@/components/ui";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error?.message ?? "Registration failed");
      router.push("/admin");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen grid place-items-center px-5 py-10 bg-bg">
      <div className="w-full max-w-sm">
        <Link href="/" className="flex items-center gap-2.5 justify-center mb-8">
          <span className="w-10 h-10 rounded-[12px] bg-accent text-onaccent flex items-center justify-center">
            <Icon name="printer" size={22} strokeWidth={2} />
          </span>
          <span className="font-display font-bold text-xl">PrintFlow</span>
        </Link>
        <div className="card p-6 sm:p-7">
          <h1 className="font-display font-bold text-xl">Create your account</h1>
          <p className="text-sm text-muted mt-1 mb-4">Set up your print shop in under two minutes.</p>
          <div className="flex items-start gap-2.5 text-[13px] bg-accent/8 border border-accent/25 rounded-[var(--radius-control)] px-3 py-2.5 mb-6">
            <Icon name="shield" size={16} className="text-accent mt-0.5" />
            <span className="text-muted">
              The <strong className="text-fg">first account registered</strong> on this system automatically becomes the{" "}
              <strong className="text-fg">platform administrator</strong>.
            </span>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Full name">
              <input className="input-base" value={name} onChange={(e) => setName(e.target.value)} placeholder="Aarav Sharma" required minLength={2} />
            </Field>
            <Field label="Email">
              <input className="input-base" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@shop.com" required />
            </Field>
            <Field label="Password" hint="At least 8 characters.">
              <input className="input-base" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required minLength={8} />
            </Field>
            {error && (
              <p className="text-[13px] font-medium text-red-400 bg-red-500/10 border border-red-500/30 rounded-[var(--radius-control)] px-3 py-2" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
              Create account
            </Button>
          </form>
        </div>
        <p className="text-center text-sm text-muted mt-5">
          Already registered?{" "}
          <Link href="/login" className="font-semibold text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
