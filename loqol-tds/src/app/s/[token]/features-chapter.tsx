"use client";

import { useMemo, useState } from "react";
import { getChapter, groupsInChapter } from "@/tds/registry";
import { isVisible, progress } from "@/tds/flow";
import {
  firstIncompleteGroup,
  isPresenceChip,
  openQuestions,
  questionsInGroup,
} from "@/tds/form-view";
import type { AnswerMap, AnswerStatus, AnswerValue } from "@/tds/types";
import { QuestionControl } from "./question-control";

const CHAPTER = "features" as const;

function withAnswer(
  map: AnswerMap,
  questionId: string,
  value: AnswerValue,
  status: AnswerStatus,
): AnswerMap {
  return {
    ...map,
    [questionId]: {
      questionId,
      value,
      status,
      source: "form",
      updatedAt: new Date().toISOString(),
    },
  };
}

const inGroup = (group: string) => questionsInGroup(CHAPTER, group);

interface Props {
  token: string;
  sellerName: string;
  initialAnswers: AnswerMap;
}

export function FeaturesChapter({ token, sellerName, initialAnswers }: Props) {
  const [answers, setAnswers] = useState<AnswerMap>(initialAnswers);
  const [index, setIndex] = useState(() => firstIncompleteGroup(CHAPTER, initialAnswers));
  const [unsaved, setUnsaved] = useState(false);
  const [voiceNote, setVoiceNote] = useState(false);

  const groups = groupsInChapter(CHAPTER);
  const chapter = getChapter(CHAPTER)!;
  const done = index >= groups.length;
  const group = groups[index];

  const chapterProgress = useMemo(
    () => progress(answers).chapters.find((c) => c.chapter === CHAPTER),
    [answers],
  );

  // Gates are evaluated against the live optimistic map, so tapping "Fireplace"
  // reveals "Which rooms?" immediately rather than after a round trip.
  const visible = group ? inGroup(group).filter((q) => isVisible(q, answers)) : [];
  const chips = visible.filter(isPresenceChip);
  const controls = visible.filter((q) => !isPresenceChip(q));
  const openControls = controls.filter((q) => !answers[q.id]);

  async function save(
    entries: Array<{ questionId: string; value: AnswerValue; status?: AnswerStatus }>,
  ) {
    if (entries.length === 0) return;
    try {
      const response = await fetch("/api/answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          answers: entries.map((e) => ({ ...e, source: "form" })),
        }),
      });
      setUnsaved(!response.ok);
    } catch {
      // Offline or a dropped connection. The answer stays on screen and the
      // seller keeps going — losing their place is far worse than a late write.
      setUnsaved(true);
    }
  }

  function record(
    questionId: string,
    value: AnswerValue,
    status: AnswerStatus = "answered",
  ) {
    setAnswers((prev) => withAnswer(prev, questionId, value, status));
    void save([{ questionId, value, status }]);
  }

  /** Untapped chips become an explicit "no" here, not before. */
  function confirmGroup() {
    const untouched = chips
      .filter((q) => !answers[q.id])
      .map((q) => ({ questionId: q.id, value: false as AnswerValue }));

    setAnswers((prev) =>
      untouched.reduce(
        (map, e) => withAnswer(map, e.questionId, false, "answered"),
        prev,
      ),
    );
    void save(untouched);
    setIndex((i) => i + 1);
  }

  if (done) {
    // Never claim the chapter is finished while things are open. The seller is
    // told what is left and can either finish it or hand it to their agent —
    // but they are never trapped here, and nothing blocks.
    const stillOpen = openQuestions(CHAPTER, answers);
    const firstOpen = stillOpen.length
      ? groups.indexOf(stillOpen[0].group ?? "")
      : -1;

    return (
      <main className="mx-auto max-w-lg px-4 py-10">
        <h1 className="text-2xl font-semibold">
          {stillOpen.length === 0
            ? `That part\u2019s done, ${sellerName.split(" ")[0]}.`
            : `You\u2019re through the list, ${sellerName.split(" ")[0]}.`}
        </h1>

        {stillOpen.length === 0 ? (
          <p className="mt-3 text-stone-600">
            You&rsquo;ve been through everything in the home. Next comes a short
            conversation about anything that isn&rsquo;t working properly.
          </p>
        ) : (
          <>
            <p className="mt-3 text-stone-600">
              {stillOpen.length} thing{stillOpen.length === 1 ? "" : "s"} you
              said you&rsquo;d come back to:
            </p>
            <ul className="mt-3 space-y-1 text-stone-600">
              {stillOpen.map((q) => (
                <li key={q.id} className="text-sm">
                  &middot; {q.sellerLabel ?? q.label}
                </li>
              ))}
            </ul>
            {firstOpen !== -1 && (
              <button
                type="button"
                onClick={() => setIndex(firstOpen)}
                className="mt-5 min-h-14 w-full rounded-xl bg-teal-700 px-5 font-semibold text-white active:bg-teal-800"
              >
                Finish these off
              </button>
            )}
            <p className="mt-4 text-sm text-stone-500">
              Or leave them &mdash; they&rsquo;ll go to your agent to sort out
              with you.
            </p>
          </>
        )}

        <button
          type="button"
          onClick={() => setIndex(groups.length - 1)}
          className="mt-6 min-h-12 rounded-xl border-2 border-stone-300 bg-white px-5 font-medium"
        >
          Go back and change something
        </button>
      </main>
    );
  }

  return (
    <div className="mx-auto max-w-lg pb-40">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-stone-50/95 px-4 py-3 backdrop-blur">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-medium text-stone-500">{chapter.title}</p>
          <p className="text-sm text-stone-500">
            {index + 1} of {groups.length}
          </p>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-200">
          <div
            className="h-full rounded-full bg-teal-700 transition-all duration-300"
            style={{ width: `${Math.round(((index) / groups.length) * 100)}%` }}
          />
        </div>
        {chapterProgress && (
          <p className="mt-1.5 text-xs text-stone-400">
            {Math.round(chapterProgress.secondsRemaining / 60) || 1} min left in this part
          </p>
        )}
      </header>

      <main className="px-4 pt-6">
        <h1 className="text-2xl font-semibold text-stone-900">{group}</h1>
        <p className="mt-1 text-stone-600">Tap everything your home has.</p>

        {chips.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {chips.map((q) => {
              const on = answers[q.id]?.value === true;
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => record(q.id, !on)}
                  aria-pressed={on}
                  className={`min-h-12 rounded-full border-2 px-4 text-base font-medium transition-colors ${
                    on
                      ? "border-teal-700 bg-teal-700 text-white"
                      : "border-stone-300 bg-white text-stone-700 active:bg-stone-100"
                  }`}
                >
                  {on && <span aria-hidden="true">✓ </span>}
                  {q.sellerLabel ?? q.label}
                </button>
              );
            })}
          </div>
        )}

        {controls.length > 0 && (
          <div className="mt-6 space-y-3">
            {controls.map((q) => (
              <QuestionControl
                key={q.id}
                question={q}
                answer={answers[q.id]}
                onChange={(value, status) => record(q.id, value, status ?? "answered")}
                onVoice={() => setVoiceNote(true)}
              />
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setVoiceNote(true)}
          className="mt-6 text-sm font-medium text-teal-800 underline underline-offset-4"
        >
          Not sure about any of these? Talk it through instead
        </button>
        {voiceNote && (
          <p className="mt-2 text-sm text-stone-500">
            Voice answering is the next thing being built — for now, anything you
            skip goes to your agent.
          </p>
        )}
      </main>

      <div className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-white/95 px-4 py-4 backdrop-blur">
        <div className="mx-auto max-w-lg">
          {unsaved && (
            <p className="mb-2 text-sm text-amber-700">
              Couldn&rsquo;t reach the server just now. Your answers are still
              here — keep going and we&rsquo;ll save them.
            </p>
          )}
          {openControls.length > 0 && (
            <p className="mb-2 text-sm text-stone-500">
              {openControls.length} follow-up
              {openControls.length === 1 ? "" : "s"} still open — you can come
              back to {openControls.length === 1 ? "it" : "them"}.
            </p>
          )}
          <div className="flex gap-2">
            {index > 0 && (
              <button
                type="button"
                onClick={() => setIndex((i) => i - 1)}
                className="min-h-14 rounded-xl border-2 border-stone-300 bg-white px-5 font-medium text-stone-700"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={confirmGroup}
              className="min-h-14 flex-1 rounded-xl bg-teal-700 px-5 text-base font-semibold text-white active:bg-teal-800"
            >
              That&rsquo;s everything here
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
