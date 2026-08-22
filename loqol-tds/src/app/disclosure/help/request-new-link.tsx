"use client";

import { useState } from "react";
import { Button, Card } from "@/app/ui";

/**
 * The one action that gets a seller out of a dead link on their own.
 *
 * The new link is never returned here — it is emailed to the address on the
 * deal. So whoever is holding the stale link can trigger a send, and only the
 * real seller can read it. The response says where it went, masked, because
 * "check your email" is useless to someone who has three.
 */
export function RequestNewLink({
  label,
  variant,
}: {
  label: string;
  variant: "primary" | "secondary";
}) {
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "sending" } | { kind: "sent"; to: string } | { kind: "failed" }
  >({ kind: "idle" });

  if (state.kind === "sent") {
    return (
      <Card tone="sunken">
        <p className="text-base font-medium text-ink">
          On its way to {state.to}
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          It usually lands within a minute. Your agent has been told as well, so
          if it doesn&rsquo;t turn up they already know to chase it.
        </p>
      </Card>
    );
  }

  return (
    <div>
      <Button
        full
        variant={variant}
        busy={state.kind === "sending"}
        onClick={async () => {
          setState({ kind: "sending" });
          try {
            const res = await fetch("/api/seller/relink", { method: "POST" });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.sentTo) setState({ kind: "sent", to: data.sentTo });
            else setState({ kind: "failed" });
          } catch {
            setState({ kind: "failed" });
          }
        }}
      >
        {label}
      </Button>
      {state.kind === "failed" && (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          That didn&rsquo;t go through. Reply to your agent&rsquo;s email and
          ask them to resend &mdash; they can do it from their end.
        </p>
      )}
    </div>
  );
}
