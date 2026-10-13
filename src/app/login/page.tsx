"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Field, Icon } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error?.message ?? "Sign in failed");
      router.push("/admin");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
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
          <h1 className="font-display font-bold text-xl">Welcome back</h1>
          <p className="text-sm text-muted mt-1 mb-6">Sign in to manage your shop and orders.</p>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Email">
              <input className="input-base" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@shop.com" required />
            </Field>
            <Field label="Password">
              <input className="input-base" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
            </Field>
            {error && (
              <p className="text-[13px] font-medium text-red-400 bg-red-500/10 border border-red-500/30 rounded-[var(--radius-control)] px-3 py-2" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
              Sign in
            </Button>
          </form>
        </div>
        <p className="text-center text-sm text-muted mt-5">
          No account yet?{" "}
          <Link href="/register" className="font-semibold text-accent hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
