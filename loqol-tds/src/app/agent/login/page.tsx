"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, inputClass } from "@/app/ui";
import { AuthShell, FormError } from "../auth-shell";

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
    <AuthShell
      title="Agent sign in"
      lead={
        <>Sellers don&rsquo;t sign in &mdash; they use the link you send them.</>
      }
      footer={
        <>
          New here?{" "}
          <Link href="/agent/signup" className="font-medium text-brand-strong underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
        {error && <FormError>{error}</FormError>}

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

        {/*
          Below the button, not beside the password field: a forgotten password
          is the exception, and putting the escape hatch in the tab order before
          the primary action makes every normal sign-in walk past it.
        */}
        <p className="text-center text-sm">
          <Link
            href="/agent/forgot-password"
            className="font-medium text-brand-strong underline"
          >
            Forgot your password?
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
