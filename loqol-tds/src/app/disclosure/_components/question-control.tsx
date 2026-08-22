"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/app/ui";
import { composedText } from "@/tds/docuseal";
import type { Answer, AnswerMap, AnswerValue, Question } from "@/tds/types";

/**
 * Everything in a group that is not a simple presence chip: the yes/no safety
 * questions, the enums, the "which rooms?" text fields.
 *
 * Every label, option and hint comes from the registry. Nothing here knows what
 * question it is rendering.
 */

interface Props {
  question: Question;
  answer?: Answer;
  /**
   * The whole set, not just this answer. A composed box is assembled from other
   * questions' follow-ups, so it cannot be rendered from its own row alone.
   */
  answers: AnswerMap;
  onChange: (
    value: AnswerValue,
    status?: "answered" | "unknown" | "skipped",
  ) => void;
  /** Modality is a default, not a jail — every question offers the other path. */
  onVoice: () => void;
  /** Contradictions touching this answer. Shown, never enforced. */
  notes?: string[];
  /**
   * This is the one the seller was just talking about. Brand, not amber —
   * warm means "two of your answers disagree" here and nothing else.
   */
  highlighted?: boolean;
}

const CHOICE =
  "min-h-12 flex-1 rounded-control border-2 px-4 text-base font-medium transition-colors";
const ON = "border-brand bg-brand text-on-brand";
const OFF = "border-line-strong bg-surface text-ink active:bg-surface-sunken";
const TEXT_INPUT =
  "w-full rounded-control border-2 border-line-strong bg-surface px-4 text-base text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none";

/**
 * A narrative box that is actually the size of a narrative.
 *
 * `long_text` used to share the single-line `text` branch, which put a
 * multi-sentence disclosure into a one-line input on a phone. It grows with the
 * content and starts tall enough to show that prose is expected.
 *
 * Controlled, because a composed box's text can change from outside it — the
 * seller pulling in an updated draft has to land in the box they are reading.
 */
function LongText({
  value,
  onCommit,
  placeholder,
  label,
}: {
  value: string;
  onCommit: (text: string) => void;
  placeholder?: string;
  label: string;
}) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Outside changes win while the seller is not mid-sentence in this box.
  useEffect(() => {
    if (document.activeElement !== ref.current) setText(value);
  }, [value]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  return (
    <textarea
      ref={ref}
      rows={4}
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== value) onCommit(text);
      }}
      placeholder={placeholder}
      className={`${TEXT_INPUT} min-h-32 resize-none py-3 leading-relaxed`}
    />
  );
}

export function QuestionControl({
  question,
  answer,
  answers,
  onChange,
  onVoice,
  notes = [],
  highlighted = false,
}: Props) {
  const unsure = answer?.status === "unknown";
  const value = unsure ? null : answer?.value;

  // A composed box holds the seller's own explanations, assembled and numbered
  // by the one function that owns that format. Until now it was only ever
  // assembled at PDF time, so the seller was asked to read over a blank input.
  const draft =
    question.docuseal.kind === "composed"
      ? composedText(question.id, answers)
      : null;
  const nothingToShow =
    draft !== null && !draft.value.trim() && !draft.composed.trim();

  return (
    <div
      className={`rounded-card border p-4 ${
        // Ring and border only. The card keeps its normal surface so every
        // contrast pair contrast-check.ts asserts still holds inside it.
        highlighted
          ? "border-brand bg-surface ring-2 ring-brand"
          : "border-line bg-surface"
      }`}
    >
      <p className="text-base font-medium text-ink">
        {/* "Here's everything you told me" over an empty box is a lie. When
            there is genuinely nothing to read back, say that instead. */}
        {nothingToShow
          ? "Nothing to read over here \u2014 you didn\u2019t flag anything that needs explaining."
          : (question.sellerLabel ?? question.label)}
      </p>
      {question.plainEnglish && !nothingToShow && (
        <p className="mt-1 text-sm text-ink-muted">{question.plainEnglish}</p>
      )}
      {nothingToShow && (
        <p className="mt-1 text-sm text-ink-muted">
          Nothing has to go here. If there is something you want a buyer to
          know anyway, there is room for it below.
        </p>
      )}

      <div className="mt-3">
        {question.type === "boolean" && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onChange(true)}
              className={`${CHOICE} ${value === true ? ON : OFF}`}
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => onChange(false)}
              className={`${CHOICE} ${value === false ? ON : OFF}`}
            >
              No
            </button>
            {/* "I don't know" is an answer, not a failure to answer. */}
            {question.allowUnknown && (
              <button
                type="button"
                onClick={() => onChange(null, "unknown")}
                className={`${CHOICE} ${unsure ? ON : OFF}`}
              >
                Not sure
              </button>
            )}
          </div>
        )}

        {/*
          Section D is a covenant about closing day, not a question — but it
          still needs an act. Without a control the seller reads "just read and
          confirm" and has nothing to confirm with, and the chapter can never
          complete.
        */}
        {question.type === "acknowledgement" && (
          <button
            type="button"
            onClick={() => onChange(true)}
            aria-pressed={answer?.value === true}
            className={`min-h-12 w-full rounded-control border-2 px-4 text-base font-medium transition-colors duration-150 ${
              answer?.value === true
                ? "border-brand bg-brand text-on-brand"
                : "border-line-strong bg-surface text-ink active:bg-surface-sunken"
            }`}
          >
            {answer?.value === true ? "Confirmed" : "I understand and confirm"}
          </button>
        )}

        {question.type === "enum" && (
          <div className="flex flex-wrap gap-2">
            {question.options?.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onChange(option.value)}
                className={`${CHOICE} ${value === option.value ? ON : OFF}`}
              >
                {option.label}
              </button>
            ))}
            {question.allowUnknown && (
              <button
                type="button"
                onClick={() => onChange(null, "unknown")}
                className={`${CHOICE} ${unsure ? ON : OFF}`}
              >
                Not sure
              </button>
            )}
          </div>
        )}

        {question.type === "multi_enum" && (
          <>
            <div className="flex flex-wrap gap-2">
              {question.options?.map((option) => {
                const selected =
                  Array.isArray(value) && value.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      const current = Array.isArray(value) ? value : [];
                      onChange(
                        selected
                          ? current.filter((v) => v !== option.value)
                          : [...current, option.value],
                      );
                    }}
                    className={`${CHOICE} ${selected ? ON : OFF}`}
                  >
                    {option.label}
                  </button>
                );
              })}
              {question.allowUnknown && (
                <button
                  type="button"
                  onClick={() => onChange(null, "unknown")}
                  className={`${CHOICE} ${unsure ? ON : OFF}`}
                >
                  Not sure
                </button>
              )}
            </div>
            <p className="mt-2 text-sm text-ink-muted">Pick as many as apply.</p>
          </>
        )}

        {question.type === "text" && (
          <input
            type="text"
            defaultValue={typeof value === "string" ? value : ""}
            onBlur={(e) => onChange(e.target.value)}
            placeholder={question.examples?.[0] ?? ""}
            className={`${TEXT_INPUT} min-h-12`}
          />
        )}

        {question.type === "long_text" && (
          <>
            <LongText
              // The draft fills the box when the seller has stored nothing;
              // once they confirm or edit, their text is what shows and what
              // prints. composedText() owns that precedence.
              value={
                draft ? draft.value : typeof value === "string" ? value : ""
              }
              onCommit={(t) => onChange(t)}
              placeholder={question.examples?.[0] ?? ""}
              label={question.sellerLabel ?? question.label}
            />

            {draft && !nothingToShow && !draft.edited && (
              <div className="mt-3">
                {/* Confirming stores this exact text, so what they signed off
                    is what prints. Until then the box stays a live draft. */}
                <Button size="md" onClick={() => onChange(draft.value)}>
                  Reads right to me
                </Button>
              </div>
            )}

            {draft?.edited && !draft.stale && !nothingToShow && (
              <p className="mt-2 text-sm text-ink-muted">
                This is the wording that goes on the form.
              </p>
            )}

            {/*
              Their earlier answers moved after they wrote this. Their words
              stay on the form; the newer draft is offered, never applied.
            */}
            {draft?.stale && (
              <div className="mt-3 rounded-control bg-attention-surface px-3 py-3">
                <p className="text-sm text-attention">
                  You changed one of your earlier answers after writing this.
                  What&rsquo;s in the box is what goes on the form — unless you
                  want the updated version.
                </p>
                <div className="mt-2">
                  <Button
                    size="md"
                    variant="secondary"
                    onClick={() => onChange(draft.composed)}
                  >
                    Show me the updated version
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {question.type === "number" && (
          <input
            type="number"
            inputMode="numeric"
            min={0}
            defaultValue={typeof value === "number" ? value : ""}
            onBlur={(e) =>
              onChange(e.target.value === "" ? null : Number(e.target.value))
            }
            className="min-h-12 w-32 rounded-control border-2 border-line-strong bg-surface px-4 text-base focus:border-brand focus:outline-none"
          />
        )}
      </div>

      {/*
        A quiet note, not a warning and not a block. The seller keeps going
        whatever this says; the review screen picks it up again at the end.
      */}
      {notes.map((note) => (
        <p
          key={note}
          className="mt-3 rounded-control bg-attention-surface px-3 py-2 text-sm text-attention"
        >
          {note}
        </p>
      ))}

      {question.whyWeAsk && (
        <p className="mt-3 text-sm text-ink-faint">{question.whyWeAsk}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
        <button
          type="button"
          onClick={onVoice}
          className="inline-flex min-h-11 items-center py-3 -my-2 text-sm font-medium underline underline-offset-4 text-brand-strong"
        >
          Rather say it out loud?
        </button>
        {/* Nothing blocks. "Come back to it" is a promise deferredQuestions()
            keeps by bringing this round again at the end. */}
        <button
          type="button"
          onClick={() => onChange(null, "skipped")}
          className={`inline-flex min-h-11 items-center py-3 -my-2 text-sm underline underline-offset-4 ${
            answer?.status === "skipped"
              ? "font-medium text-attention"
              : "text-ink-muted"
          }`}
        >
          {answer?.status === "skipped" ? "Saved for later" : "Come back to this"}
        </button>
      </div>
    </div>
  );
}
