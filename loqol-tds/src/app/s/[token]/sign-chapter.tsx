"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { agentQueue, deferredQuestions, progress } from "@/tds/flow";
import type { AnswerMap } from "@/tds/types";
import { Button, Card, Pending, Pill } from "@/app/ui";
import { AfterSigning } from "./after-signing";

/**
 * The last thing the seller does: sign it.
 *
 * WHY THIS IS NOT AN IFRAME
 *
 * DocuSeal serves its signing page with `X-Frame-Options: SAMEORIGIN` — checked
 * against a real submitter URL, not assumed — so a plain iframe pointing at
 * `/s/{slug}` is blocked by the browser and the seller gets a white box on the
 * screen where their signature goes. Their embedded signing is not an iframe
 * wrapper: `<docuseal-form>` is a custom element that renders the form into
 * this page and talks to DocuSeal's API using the submitter's own public slug.
 * That is the documented integration, and it is the better one anyway — it
 * inherits the page width and it fires a `completed` event.
 *
 * WHAT THE BROWSER IS TRUSTED WITH
 *
 * The slug, and nothing else. It is scoped to one party on one document. The
 * API key stays on the server, and the `completed` event is treated as a hint
 * to go and ask the server, never as proof: what makes this screen say "signed"
 * is always `deals.submitted_at`, set from DocuSeal's own answer.
 *
 * WHY IT POLLS
 *
 * Webhook delivery cannot be assumed — not on a laptop with no public URL, and
 * not in production either, where the honest assumption is "eventually". So the
 * status call reconciles against DocuSeal directly. The webhook makes this
 * instant; its absence makes it a few seconds.
 */

const DOCUSEAL_SCRIPT = "https://cdn.docuseal.com/js/form.js";

/** Only while the tab is in front. A backgrounded phone polls nothing. */
const POLL_MS = 4000;

/**
 * A custom element, typed as a component so the JSX stays readable.
 *
 * React 19 passes unknown attributes straight through to custom elements, so
 * every `data-*` below lands on the tag as written.
 */
const DocusealForm = "docuseal-form" as unknown as React.FC<
  { id?: string } & Record<`data-${string}`, string | undefined>
>;

interface SignState {
  state: "unsent" | "awaiting_signature" | "signed";
  configured: boolean;
  embedSrc: string | null;
  signedAt: string | null;
  sellerEmail: string | null;
  propertyAddress: string | null;
  agentName: string | null;
}

interface Props {
  sellerName: string;
  answers: AnswerMap;
  /** Back to the review screen. Nothing here is a one-way door until they sign. */
  onBack: () => void;
}

export function SignChapter({ sellerName, answers, onBack }: Props) {
  const [status, setStatus] = useState<SignState | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);

  const firstName = sellerName.split(" ")[0];

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sign");
      if (!res.ok) return;
      setStatus(await res.json());
    } catch {
      /* keep what is on screen; the next poll reconciles */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Reconcile while a signature is outstanding. Visibility-gated so a phone in
  // a pocket is not calling DocuSeal every four seconds.
  useEffect(() => {
    if (status?.state !== "awaiting_signature") return;
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [status?.state, load]);

  // DocuSeal says the form is done. A hint, not an authority — go and ask.
  useEffect(() => {
    const el = host.current?.querySelector("docuseal-form");
    if (!el) return;
    const done = () => void load();
    el.addEventListener("completed", done);
    return () => el.removeEventListener("completed", done);
  }, [status?.embedSrc, load]);

  const begin = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/sign", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "");
      setStatus(data);
    } catch {
      setError(
        "Couldn't get your form ready just now. Nothing you answered is lost — try again in a moment.",
      );
    } finally {
      setStarting(false);
    }
  }, []);

  if (!status) {
    return (
      <main id="main" className="mx-auto max-w-lg px-4 py-16">
        <Pending label="Getting your form" />
      </main>
    );
  }

  // ---------------------------------------------------------------------
  // Signed
  // ---------------------------------------------------------------------
  if (status.state === "signed") {
    const p = progress(answers);
    const forAgent = agentQueue(answers).length + deferredQuestions(answers).length;

    return (
      <main id="main" className="mx-auto max-w-lg px-4 py-10">
        <Pill tone="positive">
          <span aria-hidden="true">&#10003;</span> Signed
        </Pill>
        <h1 className="mt-4 text-2xl font-semibold">
          That&rsquo;s it, {firstName}.
        </h1>
        <p className="mt-3 text-ink-muted">
          Your disclosure is signed and on its way. Here&rsquo;s what you put
          your name to.
        </p>

        <Card tone="sunken" className="mt-6">
          {status.propertyAddress && (
            <p className="font-medium text-ink">{status.propertyAddress}</p>
          )}
          <dl className="mt-3 space-y-1.5">
            <div className="flex justify-between gap-4">
              <dt className="text-sm text-ink-muted">Questions answered</dt>
              <dd className="tabular text-sm font-medium text-ink">
                {p.chapters.reduce((n, c) => n + c.answered, 0)}
              </dd>
            </div>
            {forAgent > 0 && (
              <div className="flex justify-between gap-4">
                <dt className="text-sm text-ink-muted">
                  Left with {status.agentName ?? "your agent"}
                </dt>
                <dd className="tabular text-sm font-medium text-ink">{forAgent}</dd>
              </div>
            )}
          </dl>
          {forAgent > 0 && (
            <p className="mt-3 text-sm text-ink-muted">
              Those are the ones you weren&rsquo;t sure about. Normal, and
              they&rsquo;ll go through them with you.
            </p>
          )}
        </Card>

        <AfterSigning />
      </main>
    );
  }

  // ---------------------------------------------------------------------
  // Signing
  // ---------------------------------------------------------------------
  if (status.state === "awaiting_signature" && status.embedSrc) {
    return (
      <main id="main" className="mx-auto max-w-3xl px-4 py-6">
        <Script src={DOCUSEAL_SCRIPT} strategy="afterInteractive" />

        <h1 className="text-xl font-semibold">Read it through, then sign.</h1>
        <p className="mt-2 text-ink-muted">
          This is your answers on the actual form. It&rsquo;s long because the
          form is long &mdash; you don&rsquo;t have to fill anything in, just
          check it reads right and sign at the end.
        </p>

        <div ref={host} className="mt-6">
          <DocusealForm
            data-src={status.embedSrc}
            data-email={status.sellerEmail ?? undefined}
            data-name={sellerName}
            // Field names on this template are snake_case PDF slugs. Showing
            // them to a seller would be noise at best.
            data-with-field-names="false"
            data-with-title="false"
            data-completed-message-title="Signed. You're done."
            data-completed-message-body="We're fetching your copy — the page behind this will update in a moment."
          />
        </div>

        {/*
          The escape hatch, always present. If the CDN is blocked, if scripts
          fail, if the custom element never upgrades — the seller must still be
          able to reach the thing they came here to do. Same document, same
          submitter, DocuSeal's own page.
        */}
        <div className="mt-8 border-t border-line pt-6">
          <p className="text-sm text-ink-muted">
            Nothing showing up above?
          </p>
          <Button
            variant="secondary"
            size="md"
            className="mt-2"
            href={status.embedSrc}
            newTab
          >
            Open the form in a new tab
          </Button>
        </div>

        <div className="mt-4">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-11 items-center py-3 -my-2 text-sm font-medium text-brand-strong underline underline-offset-4"
          >
            Actually, let me change an answer first
          </button>
        </div>
      </main>
    );
  }

  // ---------------------------------------------------------------------
  // Not sent yet
  // ---------------------------------------------------------------------
  return (
    <main id="main" className="mx-auto max-w-lg px-4 py-12">
      <h1 className="text-2xl font-semibold">Ready to sign, {firstName}?</h1>
      <p className="mt-3 text-ink-muted">
        We&rsquo;ll put your answers onto the real form and show it to you. You
        read it, and if it&rsquo;s right you sign it there and then &mdash;
        nothing to print, nothing to post.
      </p>

      <Card tone="sunken" className="mt-6">
        <p className="text-sm text-ink">
          Once you sign, it can&rsquo;t be edited &mdash; that&rsquo;s what
          makes a signature mean something. If you spot something afterwards
          there&rsquo;s a button to tell your agent, and they&rsquo;ll send you a
          corrected one.
        </p>
      </Card>

      {!status.configured && (
        <Card tone="attention" className="mt-6">
          <p className="text-sm text-ink">
            Signing isn&rsquo;t switched on for this property yet. Your agent
            can sort it out &mdash; nothing you&rsquo;ve answered is lost.
          </p>
        </Card>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <Button
        full
        className="mt-8"
        busy={starting}
        disabled={!status.configured}
        onClick={begin}
      >
        Read it over and sign
      </Button>

      <div className="mt-3 text-center">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-11 items-center py-3 -my-2 text-sm font-medium text-brand-strong underline underline-offset-4"
        >
          Go back and change an answer
        </button>
      </div>
    </main>
  );
}
