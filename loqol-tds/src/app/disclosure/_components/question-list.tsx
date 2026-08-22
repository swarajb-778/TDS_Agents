"use client";

import { useState } from "react";
import { questionsInChapter, getChapter } from "@/tds/registry";
import { isVisible, progress } from "@/tds/flow";
import { conflictsFor } from "@/tds/conflicts";
import type { AnswerMap, AnswerStatus, AnswerValue, ChapterId } from "@/tds/types";
import { QuestionControl } from "./question-control";
import { useFocusQuestion } from "./use-focus-question";
import { Button, Pill } from "@/app/ui";

/**
 * The plain form rendering of a chapter — one control per visible question.
 *
 * This is where "just show me the buttons" lands. It is not a lesser path: the
 * same store, the same validation, the same audit trail.
 */

interface Props {
  chapter: ChapterId;
  initialAnswers: AnswerMap;
  /** The question the seller was on when they left the other path. */
  focusQuestionId?: string | null;
  onSwitchToVoice?: () => void;
  /** Hand the fresh map back so the other path never re-asks. */
  onWrote?: (answers: AnswerMap) => void;
  /** Chapter finished — the flow re-derives where the seller goes next. */
  onAdvance?: () => void;
}

export function QuestionList({
  chapter,
  initialAnswers,
  focusQuestionId,
  onSwitchToVoice,
  onWrote,
  onAdvance,
}: Props) {
  const [answers, setAnswers] = useState<AnswerMap>(initialAnswers);
  const [unsaved, setUnsaved] = useState(false);
  /** Only ever about the question just touched — the rest waits for review. */
  const [lastTouched, setLastTouched] = useState<string | null>(null);
  const { spotlight, target, clear } = useFocusQuestion(focusQuestionId);

  const meta = getChapter(chapter);
  const visible = questionsInChapter(chapter).filter((q) => isVisible(q, answers));
  const p = progress(answers).chapters.find((c) => c.chapter === chapter);
  const open = visible.filter((q) => !answers[q.id]).length;

  async function record(
    questionId: string,
    value: AnswerValue,
    status: AnswerStatus = "answered",
  ) {
    setLastTouched(questionId);
    clear(questionId);
    setAnswers((prev) => ({
      ...prev,
      [questionId]: {
        questionId,
        value,
        status,
        source: "form",
        updatedAt: new Date().toISOString(),
      },
    }));
    try {
      const res = await fetch("/api/answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
                  answers: [{ questionId, value, status, source: "form" }],
        }),
      });
      setUnsaved(!res.ok);
      if (res.ok) onWrote?.((await res.json()).answers);
    } catch {
      setUnsaved(true);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 pb-24 pt-6">
      {/* The chapter name is already in the sticky header above; repeating it
          here only pushes the actual question further down the screen. */}
      <h1 className="text-2xl font-semibold text-ink">{meta?.intro}</h1>
      {p && (
        <p className="mt-2 text-sm text-ink-faint">
          {p.answered} of {p.total} answered
        </p>
      )}

      {onSwitchToVoice && (
        <button
          type="button"
          onClick={onSwitchToVoice}
          className="mt-4 inline-flex min-h-11 items-center py-3 -my-2 text-sm font-medium underline underline-offset-4 text-brand-strong"
        >
          Go back to talking it through
        </button>
      )}

      {unsaved && (
        <p className="mt-4 text-sm text-attention">
          Couldn&rsquo;t reach the server just now. Your answers are still here
          &mdash; keep going and we&rsquo;ll save them.
        </p>
      )}

      <div className="mt-5 space-y-3">
        {visible.map((q) => {
          const here = q.id === spotlight;
          return (
            <div
              key={q.id}
              // Focusable only so the handoff can move the reading cursor here;
              // never in the tab order, so it costs a keyboard seller nothing.
              ref={here ? target : undefined}
              tabIndex={here ? -1 : undefined}
              aria-current={here ? "step" : undefined}
            >
              {/* Said out loud, because scrolling on its own is not an
                  explanation for why the page starts halfway down. */}
              {here && (
                <p className="mb-2">
                  <Pill tone="brand">Where we left off</Pill>
                </p>
              )}
              <QuestionControl
                question={q}
                answer={answers[q.id]}
                answers={answers}
                onChange={(value, status) => record(q.id, value, status ?? "answered")}
                onVoice={() => onSwitchToVoice?.()}
                highlighted={here}
                notes={
                  q.id === lastTouched
                    ? conflictsFor(q.id, answers).map((c) => c.message)
                    : []
                }
              />
            </div>
          );
        })}
      </div>

      {/*
        Always offered, never gated on being finished. Anything still open comes
        round again at the end, and blocking a seller here to force completeness
        is how a session gets abandoned instead of finished.
      */}
      <div className="mt-6">
        <Button full onClick={() => onAdvance?.()}>
          {open === 0 ? "Next" : `Next \u2014 ${open} still open`}
        </Button>
        {open > 0 && (
          <p className="mt-2 text-center text-sm text-ink-muted">
            You can come back to {open === 1 ? "it" : "them"} at the end.
          </p>
        )}
      </div>
    </div>
  );
}
