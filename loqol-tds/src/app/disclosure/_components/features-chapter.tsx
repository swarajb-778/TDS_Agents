"use client";

import { useState } from "react";
import { getChapter, groupsInChapter } from "@/tds/registry";
import { isVisible, resolveQuestion } from "@/tds/flow";
import {
  firstIncompleteGroup,
  isPresenceChip,
  openQuestions,
  questionsInGroup,
} from "@/tds/form-view";
import type { AnswerMap, AnswerStatus, AnswerValue } from "@/tds/types";
import { Pill } from "@/app/ui";
import { QuestionControl } from "./question-control";
import { useFocusQuestion } from "./use-focus-question";

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

/**
 * Which room to open on.
 *
 * The chapter is paginated by room, so restoring the seller's place means
 * picking the room first — landing on the right chapter and then making them
 * page through eleven rooms to find the fire alarm is not restoring anything.
 * Anything that does not resolve to a room falls back to the derived position,
 * which is what this always did.
 */
function openingGroup(
  focusQuestionId: string | null | undefined,
  answers: AnswerMap,
): number {
  const groups = groupsInChapter(CHAPTER);
  const focused = focusQuestionId ? resolveQuestion(focusQuestionId) : undefined;
  const at = focused?.group ? groups.indexOf(focused.group) : -1;
  return at === -1 ? firstIncompleteGroup(CHAPTER, answers) : at;
}

interface Props {
  sellerName: string;
  initialAnswers: AnswerMap;
  /** The question the seller was on when they left the other path. */
  focusQuestionId?: string | null;
  /** Chapter finished — the flow re-derives where the seller goes next. */
  onChapterDone?: () => void;
  /** Hand the fresh map back so the other path never re-asks. */
  onWrote?: (answers: AnswerMap) => void;
  /** Modality is a default, not a jail — even here. */
  onSwitchToVoice?: () => void;
}

export function FeaturesChapter({
  sellerName,
  initialAnswers,
  focusQuestionId,
  onChapterDone,
  onWrote,
  onSwitchToVoice,
}: Props) {
  const [answers, setAnswers] = useState<AnswerMap>(initialAnswers);
  const [index, setIndex] = useState(() =>
    openingGroup(focusQuestionId, initialAnswers),
  );
  const [unsaved, setUnsaved] = useState(false);
  const { spotlight, target, clear } = useFocusQuestion(focusQuestionId);

  const groups = groupsInChapter(CHAPTER);
  const chapter = getChapter(CHAPTER)!;
  const done = index >= groups.length;
  const group = groups[index];

  // Gates are evaluated against the live optimistic map, so tapping "Fireplace"
  // reveals "Which rooms?" immediately rather than after a round trip.
  const visible = group ? inGroup(group).filter((q) => isVisible(q, answers)) : [];
  const chips = visible.filter(isPresenceChip);
  const controls = visible.filter((q) => !isPresenceChip(q));
  const openControls = controls.filter((q) => !answers[q.id]);
  /** The question being pointed at, but only while the seller is in its room. */
  const spotlit =
    spotlight && visible.some((q) => q.id === spotlight)
      ? resolveQuestion(spotlight)
      : undefined;

  async function save(
    entries: Array<{ questionId: string; value: AnswerValue; status?: AnswerStatus }>,
  ) {
    if (entries.length === 0) return;
    try {
      const response = await fetch("/api/answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
                  answers: entries.map((e) => ({ ...e, source: "form" })),
        }),
      });
      setUnsaved(!response.ok);
      if (response.ok) onWrote?.((await response.json()).answers);
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
    clear(questionId);
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
          <>
            <p className="mt-3 text-ink-muted">
              You&rsquo;ve been through everything in the home. Next comes a short
              conversation about anything that isn&rsquo;t working properly.
            </p>
            <button
              type="button"
              onClick={() => onChapterDone?.()}
              className="mt-5 min-h-14 w-full rounded-control bg-brand px-5 font-semibold text-on-brand active:bg-brand-strong"
            >
              Keep going
            </button>
          </>
        ) : (
          <>
            <p className="mt-3 text-ink-muted">
              {stillOpen.length} thing{stillOpen.length === 1 ? "" : "s"} you
              said you&rsquo;d come back to:
            </p>
            <ul className="mt-3 space-y-1 text-ink-muted">
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
                className="mt-5 min-h-14 w-full rounded-control bg-brand px-5 font-semibold text-on-brand active:bg-brand-strong"
              >
                Finish these off
              </button>
            )}
            <p className="mt-4 text-sm text-ink-muted">
              Or leave them &mdash; they&rsquo;ll go to your agent to sort out
              with you.
            </p>
          </>
        )}

        <button
          type="button"
          onClick={() => setIndex(groups.length - 1)}
          className="mt-6 min-h-12 rounded-control border-2 border-line-strong bg-surface px-5 font-medium"
        >
          Go back and change something
        </button>
      </main>
    );
  }

  return (
    <div className="mx-auto max-w-lg pb-40">
      <div className="px-4 pt-4">
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
          <div
            className="h-full rounded-full bg-brand transition-all duration-300"
            style={{ width: `${Math.round((index / groups.length) * 100)}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-ink-faint">
          Room {index + 1} of {groups.length}
        </p>
      </div>

      <main className="px-4 pt-6">
        <h1 className="text-2xl font-semibold text-ink">{group}</h1>
        <p className="mt-1 text-ink-muted">Tap everything your home has.</p>

        {/* Named, not just ringed. A seller who cannot separate teal from grey
            still needs to know which of eleven chips they were on. */}
        {spotlit && (
          <p className="mt-4">
            <Pill tone="brand">
              Where we left off: {spotlit.sellerLabel ?? spotlit.label}
            </Pill>
          </p>
        )}

        {chips.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {chips.map((q) => {
              const on = answers[q.id]?.value === true;
              const here = q.id === spotlight;
              return (
                <button
                  key={q.id}
                  type="button"
                  ref={here ? target : undefined}
                  onClick={() => record(q.id, !on)}
                  aria-pressed={on}
                  aria-current={here ? "step" : undefined}
                  className={`min-h-12 rounded-full border-2 px-4 text-base font-medium transition-colors ${
                    on
                      ? "border-brand bg-brand text-on-brand"
                      : "border-line-strong bg-surface text-ink active:bg-surface-sunken"
                  } ${here ? "ring-2 ring-brand ring-offset-2 ring-offset-canvas" : ""}`}
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
            {controls.map((q) => {
              const here = q.id === spotlight;
              return (
                <div
                  key={q.id}
                  ref={here ? target : undefined}
                  tabIndex={here ? -1 : undefined}
                  aria-current={here ? "step" : undefined}
                >
                  <QuestionControl
                    question={q}
                    answer={answers[q.id]}
                    answers={answers}
                    onChange={(value, status) => record(q.id, value, status ?? "answered")}
                    onVoice={() => onSwitchToVoice?.()}
                    highlighted={here}
                  />
                </div>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={() => onSwitchToVoice?.()}
          className="mt-6 inline-flex min-h-11 items-center py-3 -my-2 text-sm font-medium underline underline-offset-4 text-brand-strong"
        >
          Not sure about any of these? Talk it through instead
        </button>
      </main>

      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface/95 px-4 py-4 backdrop-blur">
        <div className="mx-auto max-w-lg">
          {unsaved && (
            <p className="mb-2 text-sm text-attention">
              Couldn&rsquo;t reach the server just now. Your answers are still
              here — keep going and we&rsquo;ll save them.
            </p>
          )}
          {openControls.length > 0 && (
            <p className="mb-2 text-sm text-ink-muted">
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
                className="min-h-14 rounded-control border-2 border-line-strong bg-surface px-5 font-medium text-ink"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={confirmGroup}
              className="min-h-14 flex-1 rounded-control bg-brand px-5 text-base font-semibold text-on-brand active:bg-brand-strong"
            >
              That&rsquo;s everything here
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
