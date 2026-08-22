"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Card, Field, inputClass } from "@/app/ui";
import { AuthShell, FormError } from "../auth-shell";

export default function ForgotPassword() {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    try {
      const res = await fetch("/api/agent/password/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.fieldErrors) {
          setFieldErrors(json.fieldErrors);
          document.getElementById(Object.keys(json.fieldErrors)[0])?.focus();
        } else {
          setError(json.error ?? "Could not send the link.");
        }
        return;
      }
      setSent(email);
    } catch {
      setError("Could not reach the server. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  /* Identical for an address with an account and one without. Saying "no
   * account with that email" here would be the same leak as a distinguishable
   * sign-in failure — see the route for the argument. */
  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        lead={
          <>
            If <span className="font-medium text-ink">{sent}</span> has an account,
            a link to set a new password is on its way.
          </>
        }
        footer={
          <Link href="/agent/login" className="font-medium text-brand-strong underline">
            Back to sign in
          </Link>
        }
      >
        <Card className="mt-6" tone="sunken">
          <p className="text-ink">
            The link works once and expires in half an hour. Your current password
            keeps working until you use it.
          </p>
        </Card>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Set a new password"
      lead="Tell us the address on your account and we'll email you a link."
      footer={
        <>
          Remembered it?{" "}
          <Link href="/agent/login" className="font-medium text-brand-strong underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
        {error && <FormError>{error}</FormError>}

        <Field label="Email" htmlFor="email" error={fieldErrors.email} required>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            aria-describedby={fieldErrors.email ? "email-error" : undefined}
            className={inputClass}
          />
        </Field>

        <Button type="submit" full busy={busy}>
          {busy ? "Sending the link" : "Email me a link"}
        </Button>
      </form>
    </AuthShell>
  );
}
