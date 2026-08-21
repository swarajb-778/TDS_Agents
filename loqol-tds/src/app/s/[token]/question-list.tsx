"use client";

import { useState } from "react";
import { questionsInChapter, getChapter } from "@/tds/registry";
import { isVisible, progress } from "@/tds/flow";
import { conflictsFor } from "@/tds/conflicts";
import type { AnswerMap, AnswerStatus, AnswerValue, ChapterId } from "@/tds/types";
import { QuestionControl } from "./question-control";

/**
 * The plain form rendering of a chapter — one control per visible question.
 *
 * This is where "just show me the buttons" lands. It is not a lesser path: the
 * same store, the same validation, the same audit trail.
 */

interface Props {
  token: string;
  chapter: ChapterId;
  initialAnswers: AnswerMap;
  onSwitchToVoice?: () => void;
  /** Hand the fresh map back so the other path never re-asks. */
  onWrote?: (answers: AnswerMap) => void;
}

export function QuestionList({
  token,
  chapter,
  initialAnswers,
  onSwitchToVoice,
  onWrote,
}: Props) {
  const [answers, setAnswers] = useState<AnswerMap>(initialAnswers);
  const [unsaved, setUnsaved] = useState(false);
  /** Only ever about the question just touched — the rest waits for review. */
  const [lastTouched, setLastTouched] = useState<string | null>(null);

  const meta = getChapter(chapter);
  const visible = questionsInChapter(chapter).filter((q) => isVisible(q, answers));
  const p = progress(answers).chapters.find((c) => c.chapter === chapter);

  async function record(
    questionId: string,
    value: AnswerValue,
    status: AnswerStatus = "answered",
  ) {
    setLastTouched(questionId);
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
          token,
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
        {visible.map((q) => (
          <QuestionControl
            key={q.id}
            question={q}
            answer={answers[q.id]}
            answers={answers}
            onChange={(value, status) => record(q.id, value, status ?? "answered")}
            onVoice={() => onSwitchToVoice?.()}
            notes={q.id === lastTouched ? conflictsFor(q.id, answers).map((c) => c.message) : []}
          />
        ))}
      </div>
    </div>
  );
}
