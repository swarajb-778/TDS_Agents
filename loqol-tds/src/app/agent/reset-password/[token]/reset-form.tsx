"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, inputClass } from "@/app/ui";
import { MIN_PASSWORD_LENGTH } from "@/app/password-rules";
import { FormError } from "../../auth-shell";

export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");

    // Caught here rather than at the server: the second field exists only to
    // catch a typo in a value nobody can see, and the server has no business
    // knowing they typed it twice.
    if (password !== String(data.get("confirm") ?? "")) {
      setFieldErrors({ confirm: "These two don't match." });
      document.getElementById("confirm")?.focus();
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/agent/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.fieldErrors) {
          setFieldErrors(json.fieldErrors);
          document.getElementById(Object.keys(json.fieldErrors)[0])?.focus();
        } else {
          setError(json.error ?? "Could not set that password.");
        }
        return;
      }
      // The reset signs them in, so there is nowhere to go but in.
      router.push("/agent");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
      {error && <FormError>{error}</FormError>}

      <Field
        label="New password"
        htmlFor="password"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
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
          aria-describedby={fieldErrors.password ? "password-error" : "password-hint"}
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

      <Button type="submit" full busy={busy}>
        {busy ? "Saving" : "Save and sign in"}
      </Button>
    </form>
  );
}
