"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Field, inputClass } from "@/app/ui";
import { csrfHeader } from "@/app/csrf";
import { MIN_PASSWORD_LENGTH } from "@/app/password-rules";
import { FormError } from "../../auth-shell";

/**
 * Two independent forms, not one Save button.
 *
 * Changing a display name and changing a password are different acts with
 * different stakes — one is a typo fix, the other needs the current password
 * and cancels outstanding reset links. Bundling them means either the name
 * change asks for a password it does not need, or the password change is one
 * click away from being accidental.
 */
export function NameForm({ name }: { name: string }) {
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    setFieldErrors({});
    const data = new FormData(event.currentTarget);
    try {
      const res = await fetch("/api/agent/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...csrfHeader() },
        body: JSON.stringify({ name: data.get("name") }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.fieldErrors) setFieldErrors(json.fieldErrors);
        else setError(json.error ?? "Could not save that.");
        return;
      }
      setSaved(true);
      // The header carries the name, so it has to hear about this.
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card as="section">
      <h2 className="text-lg font-semibold">Your name</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Shown to you, not to your sellers.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
        {error && <FormError>{error}</FormError>}
        <Field label="Name" htmlFor="name" error={fieldErrors.name} required>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            defaultValue={name}
            required
            aria-describedby={fieldErrors.name ? "name-error" : undefined}
            className={inputClass}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="md" busy={busy}>
            {busy ? "Saving" : "Save name"}
          </Button>
          {saved && (
            <p role="status" className="text-sm font-medium text-positive">
              Saved.
            </p>
          )}
        </div>
      </form>
    </Card>
  );
}

export function PasswordForm() {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setFieldErrors({});
    const form = event.currentTarget;
    const data = new FormData(form);
    const newPassword = String(data.get("newPassword") ?? "");

    if (newPassword !== String(data.get("confirm") ?? "")) {
      setFieldErrors({ confirm: "These two don't match." });
      document.getElementById("confirm")?.focus();
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/agent/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeader() },
        body: JSON.stringify({
          currentPassword: data.get("currentPassword"),
          newPassword,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.fieldErrors) {
          setFieldErrors(json.fieldErrors);
          document.getElementById(Object.keys(json.fieldErrors)[0])?.focus();
        } else {
          setError(json.error ?? "Could not change the password.");
        }
        return;
      }
      setSaved(true);
      form.reset();
    } catch {
      setError("Could not reach the server. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card as="section">
      <h2 className="text-lg font-semibold">Password</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Changing it cancels any reset links you have outstanding.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
        {error && <FormError>{error}</FormError>}

        <Field
          label="Current password"
          htmlFor="currentPassword"
          error={fieldErrors.currentPassword}
          required
        >
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            aria-describedby={
              fieldErrors.currentPassword ? "currentPassword-error" : undefined
            }
            className={inputClass}
          />
        </Field>

        <Field
          label="New password"
          htmlFor="newPassword"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          error={fieldErrors.newPassword}
          required
        >
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            aria-describedby={
              fieldErrors.newPassword ? "newPassword-error" : "newPassword-hint"
            }
            className={inputClass}
          />
        </Field>

        <Field label="Type it again" htmlFor="confirm" error={fieldErrors.confirm} required>
          <input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            aria-describedby={fieldErrors.confirm ? "confirm-error" : undefined}
            className={inputClass}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="md" busy={busy}>
            {busy ? "Changing" : "Change password"}
          </Button>
          {saved && (
            <p role="status" className="text-sm font-medium text-positive">
              Changed. We&rsquo;ve emailed you a note about it.
            </p>
          )}
        </div>
      </form>
    </Card>
  );
}
