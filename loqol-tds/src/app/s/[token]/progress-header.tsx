"use client";

import { progress } from "@/tds/flow";
import type { AnswerMap, ChapterId } from "@/tds/types";

/**
 * Chapters and minutes, never "field 87 of 150".
 *
 * A raw field count would lie: a seller with no defects has a genuinely shorter
 * form than one with defects, because half the questions are gated. progress()
 * counts only what is currently visible and sums the time left on it.
 */
export function ProgressHeader({
  answers,
  current,
}: {
  answers: AnswerMap;
  current: ChapterId;
}) {
  const p = progress(answers);
  const shown = p.chapters.filter((c) => c.total > 0);
  const here = shown.findIndex((c) => c.chapter === current);
  const title = shown[here]?.title ?? "";

  return (
    <header className="sticky top-0 z-10 border-b border-line bg-canvas/95 px-4 py-3 backdrop-blur">
      <div className="flex items-baseline justify-between gap-3">
        <p className="truncate text-sm font-medium text-ink-muted">{title}</p>
        <p className="shrink-0 text-sm text-ink-muted">{p.label}</p>
      </div>

      {/* One segment per chapter — the seller can see the shape of what's left. */}
      <div className="mt-2 flex gap-1" aria-hidden="true">
        {shown.map((c, i) => (
          <div
            key={c.chapter}
            className={`h-1.5 flex-1 rounded-full ${
              c.state === "complete"
                ? "bg-brand"
                : i === here
                  ? "bg-brand/40"
                  : "bg-surface-sunken"
            }`}
          />
        ))}
      </div>

      <p className="sr-only">
        {title}. Part {here + 1} of {shown.length}. {p.label}.
      </p>
    </header>
  );
}
