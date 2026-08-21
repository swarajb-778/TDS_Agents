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
  token: string;
  sellerName: string;
  answers: AnswerMap;
  onRevisit: () => void;
}

export function Review({ token, sellerName, answers, onRevisit }: Props) {
  const [conflicts, setConflicts] = useState<ReviewedConflict[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/conflicts?token=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : { conflicts: [] }))
      .then((d) => setConflicts(d.conflicts ?? []))
      .catch(() => setConflicts([]));
  }, [token]);

  async function setAcknowledged(ruleId: string, undo: boolean) {
    setBusy(ruleId);
    try {
      const res = await fetch("/api/conflicts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ruleId, undo }),
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
      <p className="mt-3 text-stone-600">
        {open.length === 0
          ? "Nothing looks contradictory. Have a last look, then it goes to your agent."
          : `A few answers don't quite line up. Have a look — you might well be right about both.`}
      </p>

      {open.map((c) => (
        <section
          key={c.ruleId}
          className={`mt-5 rounded-2xl border p-4 ${
            c.severity === "hard"
              ? "border-amber-300 bg-amber-50"
              : "border-stone-200 bg-white"
          }`}
        >
          <p className="text-base text-stone-900">{c.message}</p>

          {/* Both answers, quoted back in their own words. */}
          <dl className="mt-3 space-y-2">
            {c.involves.map((id) => {
              const s = describeAnswer(id, answers);
              if (!s) return null;
              return (
                <div key={id} className="rounded-xl bg-white/70 px-3 py-2">
                  <dt className="text-sm text-stone-500">{s.label}</dt>
                  <dd className="text-base font-medium text-stone-900">
                    You said: {s.value}
                  </dd>
                  {s.verbatim && (
                    <dd className="mt-1 text-sm italic text-stone-500">
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
              className="min-h-12 flex-1 rounded-xl bg-teal-700 px-4 font-medium text-white active:bg-teal-800"
            >
              Change an answer
            </button>
            <button
              type="button"
              disabled={busy === c.ruleId}
              onClick={() => setAcknowledged(c.ruleId, false)}
              className="min-h-12 flex-1 rounded-xl border-2 border-stone-300 bg-white px-4 font-medium text-stone-700 disabled:opacity-50"
            >
              Both are right
            </button>
          </div>
        </section>
      ))}

      {settled.length > 0 && (
        <section className="mt-6">
          <p className="text-sm font-medium text-stone-500">
            You said these are both right
          </p>
          <ul className="mt-2 space-y-2">
            {settled.map((c) => (
              <li key={c.ruleId} className="text-sm text-stone-600">
                &middot; {c.message.split(".")[0]}.{" "}
                <button
                  type="button"
                  onClick={() => setAcknowledged(c.ruleId, true)}
                  className="font-medium text-teal-800 underline underline-offset-4"
                >
                  Look again
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(deferred.length > 0 || forAgent.length > 0) && (
        <section className="mt-6 rounded-2xl border border-stone-200 bg-white p-4">
          <p className="text-sm font-medium text-stone-500">
            Going to your agent
          </p>
          <ul className="mt-2 space-y-1">
            {[...deferred, ...forAgent].map((q) => (
              <li key={q.id} className="text-sm text-stone-700">
                &middot; {q.sellerLabel ?? q.label}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-stone-500">
            These are normal. Your agent will go through them with you rather
            than leave them blank.
          </p>
          <button
            type="button"
            onClick={onRevisit}
            className="mt-3 text-sm font-medium text-teal-800 underline underline-offset-4"
          >
            Actually, let me have another go at these
          </button>
        </section>
      )}

      <button
        type="button"
        className="mt-8 min-h-14 w-full rounded-xl bg-teal-700 px-5 font-semibold text-white active:bg-teal-800"
      >
        Send to my agent
      </button>
      <p className="mt-2 text-center text-sm text-stone-500">
        You&rsquo;ll get the form to sign once they&rsquo;ve looked it over.
      </p>
    </main>
  );
}
