"use client";

import { useCallback, useState } from "react";
import { deferredQuestions, nextQuestion, resume } from "@/tds/flow";
import type { AnswerMap, ChapterId, Modality } from "@/tds/types";
import { FeaturesChapter } from "./features-chapter";
import { ProgressHeader } from "./progress-header";
import { QuestionList } from "./question-list";
import { VoiceChapter } from "./voice-chapter";

/**
 * Owns where the seller is and which path they are on.
 *
 * Position is derived from the answers on every render, never stored, which is
 * what makes closing the tab safe and modality switching free. The only thing
 * persisted is the *preference*: which path they were last using.
 */

interface Props {
  token: string;
  sellerName: string;
  initialAnswers: AnswerMap;
  initialModality: Modality | null;
}

export function SellerFlow({ token, sellerName, initialAnswers, initialModality }: Props) {
  const [answers, setAnswers] = useState<AnswerMap>(initialAnswers);
  const [override, setOverride] = useState<Modality | null>(null);
  const [landed, setLanded] = useState(false);

  const next = nextQuestion(answers);
  const chapter: ChapterId = next.chapter ?? "features";
  const firstName = sellerName.split(" ")[0];

  const suggested: Modality =
    next.question?.defaultModality === "voice" ? "voice" : "form";
  // A choice the seller actually made outranks the chapter's default. Absent a
  // choice, the registry decides where they land.
  const modality = override ?? initialModality ?? suggested;

  /** Every write returns the fresh map, so the two paths cannot drift apart. */
  const absorb = useCallback((updated?: AnswerMap) => {
    if (updated) setAnswers(updated);
  }, []);

  /** Voice writes happen server-side; pull the map back after each one. */
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/answers?token=${encodeURIComponent(token)}`);
      if (res.ok) setAnswers((await res.json()).answers);
    } catch {
      /* keep what is on screen; the next write will reconcile */
    }
  }, [token]);

  const switchTo = useCallback(
    async (to: Modality) => {
      // Pick up anything the other path recorded before rendering this one,
      // or the seller gets asked something they already answered.
      await refresh();
      setOverride(to);
      // Explicit choice, so it is worth remembering for re-entry.
      void fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, modality: to }),
      });
    },
    [refresh, token],
  );

  if (next.done) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <h1 className="text-2xl font-semibold">You&rsquo;re done, {firstName}.</h1>
        <p className="mt-3 text-stone-600">
          Everything&rsquo;s answered. Your agent reviews it next and sends the
          form over for signature.
        </p>
      </main>
    );
  }

  // Welcome-back. Shown once per visit, naming the place rather than a
  // percentage, and offering a way out that is not "keep going".
  if (!landed) {
    const state = resume(answers, modality);
    const deferred = deferredQuestions(answers);
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <h1 className="text-2xl font-semibold">
          {state.chapterTitle ? `Welcome back, ${firstName}.` : `Hi ${firstName}.`}
        </h1>
        <p className="mt-3 text-stone-600">{state.message}</p>

        {deferred.length > 0 && (
          <p className="mt-4 rounded-xl bg-white p-3 text-sm text-stone-600 ring-1 ring-stone-200">
            {deferred.length} thing{deferred.length === 1 ? "" : "s"} you asked to
            come back to {deferred.length === 1 ? "is" : "are"} still waiting —
            {deferred.length === 1 ? " it" : " they"}&rsquo;ll come round again at
            the end.
          </p>
        )}

        <button
          type="button"
          onClick={() => setLanded(true)}
          className="mt-6 min-h-14 w-full rounded-xl bg-teal-700 px-5 font-semibold text-white active:bg-teal-800"
        >
          {state.chapterTitle ? "Pick up where I left off" : "Let's go"}
        </button>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setOverride(suggested === "voice" ? "form" : "voice");
              setLanded(true);
            }}
            className="min-h-12 flex-1 rounded-xl border-2 border-stone-300 bg-white px-4 text-sm font-medium text-stone-700"
          >
            {suggested === "voice" ? "I'd rather tap than talk" : "I'd rather talk it through"}
          </button>
        </div>
      </main>
    );
  }

  if (chapter === "features") {
    return (
      <>
        <ProgressHeader answers={answers} current={chapter} />
        <FeaturesChapter
          token={token}
          sellerName={sellerName}
          initialAnswers={answers}
          onWrote={absorb}
          onChapterDone={() => void refresh()}
        />
      </>
    );
  }

  if (modality === "voice") {
    return (
      <VoiceChapter
        key={`voice-${chapter}`}
        token={token}
        chapter={chapter}
        onWrote={() => void refresh()}
        onSwitchToForm={() => void switchTo("form")}
      />
    );
  }

  return (
    <>
      <ProgressHeader answers={answers} current={chapter} />
      <QuestionList
        key={`form-${chapter}-${Object.keys(answers).length}`}
        token={token}
        chapter={chapter}
        initialAnswers={answers}
        onWrote={absorb}
        onSwitchToVoice={() => void switchTo("voice")}
      />
    </>
  );
}
