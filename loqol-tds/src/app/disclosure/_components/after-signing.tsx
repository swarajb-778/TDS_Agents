"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card } from "@/app/ui";

/**
 * What happens after the seller signs.
 *
 * Three jobs, in the order a seller needs them:
 *
 *   1. Their copy. A legal document they just signed under penalty, and they
 *      should not have to go looking in an inbox for it.
 *   2. What happens next, in words. Not "pending countersignature" — a person,
 *      an action, and roughly when.
 *   3. "I need to change something."
 *
 * The third is the one that earns its place. Sellers remember the water heater
 * at 11pm, an hour after signing. Without a button for it they email their
 * agent in a panic and the problem leaves the product — so the disclosure stays
 * wrong and nobody here ever finds out. The button does NOT reopen the
 * document: a signed disclosure is not editable by anyone, and pretending
 * otherwise would be the worst thing this system could do. It flags the deal,
 * and the agent sends a fresh form.
 *
 * Rendered both by the signing step (straight after signing) and by the
 * read-only view a seller lands on when they come back through their link.
 */

interface SignState {
  state: "unsent" | "awaiting_signature" | "signed";
  signedAt: string | null;
  changeRequestedAt: string | null;
  agentName: string | null;
}

const WHEN = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
  timeStyle: "short",
});

export function AfterSigning() {
  const [status, setStatus] = useState<SignState | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/sign")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setStatus(d))
      .catch(() => {
        /* the download and the copy below stand on their own */
      });
    return () => {
      live = false;
    };
  }, []);

  const submitChange = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/sign/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setStatus((s) =>
        s ? { ...s, changeRequestedAt: data.changeRequestedAt } : s,
      );
      setAsking(false);
    } catch {
      // Never a dead end. The words stay on screen and they can try again.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [note]);

  const agent = status?.agentName ?? "your agent";
  const flagged = Boolean(status?.changeRequestedAt);

  return (
    <>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        {/* An anchor, not a button: this is a download, and the browser is
            better at downloads than any JavaScript here would be. */}
        <Button href="/api/sign/document" download full>
          Download my signed copy
        </Button>
      </div>
      <p className="mt-2 text-sm text-ink-faint">
        A PDF, about a megabyte. Keep it somewhere you&rsquo;ll find it.
      </p>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">What happens now</h2>
        <ol className="mt-3 space-y-3">
          <li className="text-ink-muted">
            <span className="font-medium text-ink">{agent} signs a copy.</span>{" "}
            They&rsquo;re confirming they passed it on &mdash; they can&rsquo;t
            change anything you wrote.
          </li>
          <li className="text-ink-muted">
            <span className="font-medium text-ink">
              You get a copy by email
            </span>{" "}
            as well as the one above, so it isn&rsquo;t only on this phone.
          </li>
          {/*
            Where the buyer's acknowledgement of receipt attaches. It is a
            SECOND submission against the same template, created when an offer
            arrives, using the Buyer 1 / Buyer 2 roles that src/tds/docuseal.ts
            deliberately leaves unassigned. Out of scope here: at disclosure
            time there is no buyer to send it to.
          */}
          <li className="text-ink-muted">
            <span className="font-medium text-ink">
              When someone makes an offer,
            </span>{" "}
            they read this and sign to say they received it. Nothing for you to
            do then.
          </li>
        </ol>
      </section>

      <section className="mt-8">
        {flagged ? (
          <Card tone="attention">
            <p className="font-medium text-ink">{agent} has been told.</p>
            <p className="mt-2 text-sm text-ink-muted">
              Nothing you&rsquo;ve done is lost. They&rsquo;ll send you a fresh
              form with the correction on it &mdash; it&rsquo;s much quicker the
              second time, because everything else carries over.
            </p>
          </Card>
        ) : !asking ? (
          <>
            <p className="text-ink-muted">
              Remembered something? That happens more often than you&rsquo;d
              think.
            </p>
            <Button
              variant="secondary"
              full
              className="mt-3"
              onClick={() => setAsking(true)}
            >
              I need to change something
            </Button>
          </>
        ) : (
          <Card>
            <h2 className="text-lg font-semibold">What&rsquo;s different?</h2>
            <p className="mt-2 text-sm text-ink-muted">
              A signed form can&rsquo;t be edited &mdash; not by you, not by us,
              not by {agent}. Tell them what&rsquo;s changed and they&rsquo;ll
              send you a new one to sign. Everything else carries over.
            </p>
            <label
              htmlFor="change-note"
              className="mt-4 block text-sm font-medium text-ink"
            >
              In your own words
            </label>
            <textarea
              id="change-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="The water heater is electric, not gas — I checked the label."
              className="mt-1.5 w-full rounded-control border-2 border-line-strong bg-surface px-3 py-2 text-base text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
            />
            {failed && (
              <p role="alert" className="mt-2 text-sm font-medium text-danger">
                That didn&rsquo;t send. Your words are still here &mdash; try
                once more.
              </p>
            )}
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Button full busy={busy} onClick={submitChange}>
                Tell {agent}
              </Button>
              <Button
                variant="secondary"
                full
                disabled={busy}
                onClick={() => setAsking(false)}
              >
                Never mind
              </Button>
            </div>
          </Card>
        )}
      </section>

      {status?.signedAt && (
        <p className="mt-10 text-sm text-ink-faint">
          Signed {WHEN.format(new Date(status.signedAt))}.
        </p>
      )}
    </>
  );
}
