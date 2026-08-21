"use client";

import { useState } from "react";
import { Button } from "@/app/ui";
import { csrfHeader } from "@/app/csrf";

/** Issuing a new link revokes the old one, so only ever one works. */
export function ReissueLink({ dealId }: { dealId: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  if (link) {
    return (
      <Button
        size="md"
        variant="secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(link);
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        }}
      >
        {copied ? "Copied" : "Copy new link"}
      </Button>
    );
  }

  return (
    <Button
      size="md"
      variant="secondary"
      busy={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/agent/deals/${dealId}/link`, {
            method: "POST",
            headers: csrfHeader(),
          });
          if (res.ok) setLink((await res.json()).link);
        } finally {
          setBusy(false);
        }
      }}
    >
      Send a fresh link
    </Button>
  );
}
