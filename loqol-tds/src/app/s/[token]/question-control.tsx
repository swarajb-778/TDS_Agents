"use client";

import type { Answer, AnswerValue, Question } from "@/tds/types";

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
  onChange: (
    value: AnswerValue,
    status?: "answered" | "unknown" | "skipped",
  ) => void;
  /** Modality is a default, not a jail — every question offers the other path. */
  onVoice: () => void;
}

const CHOICE =
  "min-h-12 flex-1 rounded-xl border-2 px-4 text-base font-medium transition-colors";
const ON = "border-teal-700 bg-teal-700 text-white";
const OFF = "border-stone-300 bg-white text-stone-700 active:bg-stone-100";

export function QuestionControl({ question, answer, onChange, onVoice }: Props) {
  const unsure = answer?.status === "unknown";
  const value = unsure ? null : answer?.value;

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <p className="text-base font-medium text-stone-900">
        {question.sellerLabel ?? question.label}
      </p>
      {question.plainEnglish && (
        <p className="mt-1 text-sm text-stone-500">{question.plainEnglish}</p>
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
            <p className="mt-2 text-sm text-stone-500">Pick as many as apply.</p>
          </>
        )}

        {(question.type === "text" || question.type === "long_text") && (
          <input
            type="text"
            defaultValue={typeof value === "string" ? value : ""}
            onBlur={(e) => onChange(e.target.value)}
            placeholder={question.examples?.[0] ?? ""}
            className="min-h-12 w-full rounded-xl border-2 border-stone-300 bg-white px-4 text-base focus:border-teal-700 focus:outline-none"
          />
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
            className="min-h-12 w-32 rounded-xl border-2 border-stone-300 bg-white px-4 text-base focus:border-teal-700 focus:outline-none"
          />
        )}
      </div>

      {question.whyWeAsk && (
        <p className="mt-3 text-sm text-stone-400">{question.whyWeAsk}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
        <button
          type="button"
          onClick={onVoice}
          className="text-sm font-medium text-teal-800 underline underline-offset-4"
        >
          Rather say it out loud?
        </button>
        {/* Nothing blocks. "Come back to it" is a promise deferredQuestions()
            keeps by bringing this round again at the end. */}
        <button
          type="button"
          onClick={() => onChange(null, "skipped")}
          className={`text-sm underline underline-offset-4 ${
            answer?.status === "skipped"
              ? "font-medium text-amber-700"
              : "text-stone-500"
          }`}
        >
          {answer?.status === "skipped" ? "Saved for later" : "Come back to this"}
        </button>
      </div>
    </div>
  );
}
