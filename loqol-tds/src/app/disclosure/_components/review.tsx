"use client";

import { useEffect, useState } from "react";
import { agentQueue, deferredQuestions } from "@/tds/flow";
import { describeAnswer } from "@/tds/form-view";
import type { AnswerMap } from "@/tds/types";

/**
 * The last screen before signing.
 *
 * Everything here is a question, never a correction. A contradiction gets both
 * answers quoted back with "which is right?" — because the seller usually is
 * not wrong, the form is confusing, and sometimes both answers are genuinely
 * true. Nothing on this screen prevents finishing.
 */

interface ReviewedConflict {
  ruleId: string;
  severity: "hard" | "soft";
  involves: string[];
  message: string;
  acknowledged: boolean;
}

interface Props {
  sellerName: string;
  answers: AnswerMap;
  onRevisit: () => void;
  /** On to the signature step. Nothing on this screen blocks reaching it. */
  onSign: () => void;
}

export function Review({ sellerName, answers, onRevisit, onSign }: Props) {
  const [conflicts, setConflicts] = useState<ReviewedConflict[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Undefined until we know. The last button stays put rather than flickering. */
  const [signed, setSigned] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    fetch("/api/conflicts")
      .then((r) => (r.ok ? r.json() : { conflicts: [] }))
      .then((d) => setConflicts(d.conflicts ?? []))
      .catch(() => setConflicts([]));
  }, []);

  /*
   * A seller who has already signed and comes back through their link must not
   * be asked to sign a second time. The signing step owns every post-signature
   * state, including "I need to change something", so hand straight over.
   */
  useEffect(() => {
    let live = true;
    fetch("/api/sign")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d) return setSigned(false);
        setSigned(d.state === "signed");
        if (d.state === "signed") onSign();
      })
      .catch(() => live && setSigned(false));
    return () => {
      live = false;
    };
    // Once, on mount. onSign is a setState wrapper and is stable in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setAcknowledged(ruleId: string, undo: boolean) {
    setBusy(ruleId);
    try {
      const res = await fetch("/api/conflicts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleId, undo }),
      });
      if (res.ok) setConflicts((await res.json()).conflicts);
    } catch {
      /* leave it on screen; nothing here blocks finishing */
    } finally {
      setBusy(null);
    }
  }

  const deferred = deferredQuestions(answers);
  const forAgent = agentQueue(answers);
  const open = (conflicts ?? []).filter((c) => !c.acknowledged);
  const settled = (conflicts ?? []).filter((c) => c.acknowledged);

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <h1 className="text-2xl font-semibold">
        Nearly there, {sellerName.split(" ")[0]}.
      </h1>
      <p className="mt-3 text-ink-muted">
        {open.length === 0
          ? "Nothing looks contradictory. Have a last look, then it goes to your agent."
          : `A few answers don't quite line up. Have a look — you might well be right about both.`}
      </p>

      {open.map((c) => (
        <section
          key={c.ruleId}
          className={`mt-5 rounded-card border p-4 ${
            c.severity === "hard"
              ? "border-attention-line bg-attention-surface"
              : "border-line bg-surface"
          }`}
        >
          <p className="text-base text-ink">{c.message}</p>

          {/* Both answers, quoted back in their own words. */}
          <dl className="mt-3 space-y-2">
            {c.involves.map((id) => {
              const s = describeAnswer(id, answers);
              if (!s) return null;
              return (
                <div key={id} className="rounded-control bg-surface/70 px-3 py-2">
                  <dt className="text-sm text-ink-muted">{s.label}</dt>
                  <dd className="text-base font-medium text-ink">
                    You said: {s.value}
                  </dd>
                  {s.verbatim && (
                    <dd className="mt-1 text-sm italic text-ink-muted">
                      &ldquo;{s.verbatim}&rdquo;
                    </dd>
                  )}
                </div>
              );
            })}
          </dl>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onRevisit}
              className="min-h-12 flex-1 rounded-control bg-brand px-4 font-medium text-on-brand active:bg-brand-strong"
            >
              Change an answer
            </button>
            <button
              type="button"
              disabled={busy === c.ruleId}
              onClick={() => setAcknowledged(c.ruleId, false)}
              className="min-h-12 flex-1 rounded-control border-2 border-line-strong bg-surface px-4 font-medium text-ink disabled:opacity-50"
            >
              Both are right
            </button>
          </div>
        </section>
      ))}

      {settled.length > 0 && (
        <section className="mt-6">
          <p className="text-sm font-medium text-ink-muted">
            You said these are both right
          </p>
          <ul className="mt-2 space-y-2">
            {settled.map((c) => (
              <li key={c.ruleId} className="text-sm text-ink-muted">
                &middot; {c.message.split(".")[0]}.{" "}
                <button
                  type="button"
                  onClick={() => setAcknowledged(c.ruleId, true)}
                  className="inline-flex min-h-11 items-center py-3 -my-2 text-sm font-medium underline underline-offset-4 text-brand-strong"
                >
                  Look again
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(deferred.length > 0 || forAgent.length > 0) && (
        <section className="mt-6 rounded-card border border-line bg-surface p-4">
          <p className="text-sm font-medium text-ink-muted">
            Going to your agent
          </p>
          <ul className="mt-2 space-y-1">
            {[...deferred, ...forAgent].map((q) => (
              <li key={q.id} className="text-sm text-ink">
                &middot; {q.sellerLabel ?? q.label}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-ink-muted">
            These are normal. Your agent will go through them with you rather
            than leave them blank.
          </p>
          <button
            type="button"
            onClick={onRevisit}
            className="mt-3 inline-flex min-h-11 items-center py-3 -my-2 text-sm font-medium underline underline-offset-4 text-brand-strong"
          >
            Actually, let me have another go at these
          </button>
        </section>
      )}

      {/*
        The one action on this screen, and nothing above can disable it. A
        contradiction the seller stands by, a question they left for their
        agent — none of that stops them finishing. An abandoned session is
        worse than an inconsistent one.
      */}
      <button
        type="button"
        onClick={onSign}
        disabled={signed === undefined}
        className="mt-8 min-h-14 w-full rounded-control bg-brand px-5 font-semibold text-on-brand transition-colors duration-150 active:bg-brand-strong disabled:opacity-45"
      >
        Read it over and sign
      </button>
      <p className="mt-2 text-center text-sm text-ink-muted">
        We&rsquo;ll show you your answers on the real form. You sign it there,
        and your agent signs after you.
      </p>
    </main>
  );
}
