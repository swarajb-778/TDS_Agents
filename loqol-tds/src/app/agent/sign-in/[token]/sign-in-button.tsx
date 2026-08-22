"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/app/ui";
import { FormError } from "../../auth-shell";

/**
 * The click that spends the token.
 *
 * A button rather than the page load itself: a single-use link that a mail
 * scanner can burn on delivery is a link the human never gets to use.
 */
export function SignInButton({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "Could not sign you in.");
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
    <div className="mt-6 space-y-4">
      {error && <FormError>{error}</FormError>}
      <Button full busy={busy} onClick={signIn}>
        {busy ? "Signing you in" : "Sign in"}
      </Button>
    </div>
  );
}
