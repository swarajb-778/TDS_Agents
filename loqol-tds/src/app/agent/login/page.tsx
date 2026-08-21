"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, inputClass } from "@/app/ui";

export default function AgentLogin() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const res = await fetch("/api/agent/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.get("email"),
          password: data.get("password"),
        }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "Could not sign in.");
        return;
      }
      router.push("/agent");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-12">
      <p className="text-sm font-semibold tracking-wide text-brand-strong uppercase">Loqol</p>
      <h1 className="mt-2 text-2xl font-semibold">Agent sign in</h1>
      <p className="mt-2 text-ink-muted">
        Sellers don&rsquo;t sign in &mdash; they use the link you send them.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
        {error && (
          <p role="alert" className="rounded-control bg-danger-surface px-3 py-2 text-sm font-medium text-danger">
            {error}
          </p>
        )}

        <Field label="Email" htmlFor="email" required>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            className={inputClass}
          />
        </Field>

        <Field label="Password" htmlFor="password" required>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className={inputClass}
          />
        </Field>

        <Button type="submit" full busy={busy}>
          {busy ? "Signing in" : "Sign in"}
        </Button>
      </form>
    </main>
  );
}
