"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Card, Field, inputClass } from "@/app/ui";
import { MIN_PASSWORD_LENGTH } from "@/app/password-rules";
import { AuthShell, FormError } from "../auth-shell";

export default function AgentSignup() {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [delivered, setDelivered] = useState(true);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "");
    try {
      const res = await fetch("/api/agent/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          email,
          password: data.get("password"),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.fieldErrors) {
          setFieldErrors(json.fieldErrors);
          document.getElementById(Object.keys(json.fieldErrors)[0])?.focus();
        } else {
          setError(json.error ?? "Could not create the account.");
        }
        return;
      }
      setDelivered(json.delivered !== false);
      setSent(email);
    } catch {
      setError("Could not reach the server. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  /*
   * One outcome, whatever happened.
   *
   * This screen is shown whether the address was free or already had an
   * account, and it never says which. It does say what the email will contain,
   * because describing both possibilities gives away nothing — only the person
   * holding the mailbox learns which one arrived.
   */
  /*
   * No provider wired, so there is no email to check and saying otherwise is
   * how a working signup reads as a broken one. Still one outcome whatever
   * happened: this copy is identical for a free address and a taken one, and
   * only the person who knows the account's password learns which they had.
   */
  if (sent && !delivered) {
    return (
      <AuthShell
        title="Now sign in"
        lead={
          <>
            This build doesn&rsquo;t send email, so there&rsquo;s no link to wait
            for. Sign in with{" "}
            <span className="font-medium text-ink">{sent}</span>.
          </>
        }
        footer={
          <>
            Wiring a real provider is one function in{" "}
            <code className="text-ink">src/mail/send.ts</code> — until then, links
            are written to the server log.
          </>
        }
      >
        <Link href="/agent/login" className="mt-8 block">
          <Button full>Go to sign in</Button>
        </Link>
        {/*
          * Both cases, equal weight. Leading with "the password you just chose"
          * is wrong for anyone who already had an account — signing up again is
          * a no-op by design, so that password was never stored, and the sign-in
          * that follows fails for a reason the screen just talked them out of
          * suspecting. Which case you are in stays unsaid; only your own
          * password reveals it.
          */}
        <Card className="mt-4" tone="sunken">
          <p className="text-sm text-ink">
            <strong className="font-medium">New here?</strong> Use the password
            you just chose.
          </p>
          <p className="mt-3 text-sm text-ink">
            <strong className="font-medium">Signed up before?</strong> Nothing
            changed — that account keeps its original password, and the one you
            just typed was not saved.
          </p>
        </Card>
      </AuthShell>
    );
  }

  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        lead={
          <>
            We&rsquo;ve sent a message to <span className="font-medium text-ink">{sent}</span>.
          </>
        }
        footer={
          <>
            Nothing arrived? Check the spam folder, or{" "}
            <Link href="/agent/signup" className="font-medium text-brand-strong underline">
              try again
            </Link>
            .
          </>
        }
      >
        <Card className="mt-6" tone="sunken">
          <p className="text-ink">
            If that address was new, your account is ready and the email has a link
            that signs you straight in. If it already had an account, the email says
            so and points you at signing in instead.
          </p>
          <p className="mt-3 text-sm text-ink-muted">
            Either way you can sign in with your email and password &mdash; the link
            just saves you typing it.
          </p>
          <Link href="/agent/login" className="mt-4 inline-block">
            <Button size="md" variant="secondary">
              Go to sign in
            </Button>
          </Link>
        </Card>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      lead="For listing agents. Your sellers never sign up — they get a link."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/agent/login" className="font-medium text-brand-strong underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
        {error && <FormError>{error}</FormError>}

        <Field label="Your name" htmlFor="name" error={fieldErrors.name} required>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
            aria-describedby={fieldErrors.name ? "name-error" : undefined}
            className={inputClass}
          />
        </Field>

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

        <Field
          label="Password"
          htmlFor="password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters. Length is the only rule — a few words you'll remember beats a short scramble.`}
          error={fieldErrors.password}
          required
        >
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            aria-describedby={
              fieldErrors.password ? "password-error" : "password-hint"
            }
            className={inputClass}
          />
        </Field>

        <Button type="submit" full busy={busy}>
          {busy ? "Creating your account" : "Create account"}
        </Button>
      </form>
    </AuthShell>
  );
}
