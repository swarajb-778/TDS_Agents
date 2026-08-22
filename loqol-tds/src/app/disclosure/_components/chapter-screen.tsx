"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { inDeferralPass } from "@/tds/flow";
import type { AnswerMap, ChapterId, Modality } from "@/tds/types";
import { FeaturesChapter } from "./features-chapter";
import { ProgressHeader } from "./progress-header";
import { QuestionList } from "./question-list";
import { VoiceChapter } from "./voice-chapter";

/**
 * One chapter, in one modality. Much thinner than the state machine it
 * replaces, because the routing now lives in the URL.
 *
 * What it deliberately does NOT do is decide where the seller goes next.
 * Finishing a chapter navigates to /disclosure, which re-derives that on the
 * server against freshly loaded answers. Position stays a function of the
 * answers; the URL is a view of it, not a rival source of truth.
 */

interface Props {
  chapter: ChapterId;
  modality: Modality;
  sellerName: string;
  initialAnswers: AnswerMap;
}

export function ChapterScreen({
  chapter,
  modality,
  sellerName,
  initialAnswers,
}: Props) {
  const router = useRouter();
  const [answers, setAnswers] = useState<AnswerMap>(initialAnswers);

  const absorb = useCallback((updated?: AnswerMap) => {
    if (updated) setAnswers(updated);
  }, []);

  /** Hand back to the dispatcher; it decides what comes next. */
  const advance = useCallback(() => {
    router.push("/disclosure");
  }, [router]);

  /**
   * Switching path is a navigation now, which is the point: it survives a
   * refresh and a back button. The preference is still recorded, because it is
   * an actual choice and re-entry should honour it.
   */
  const switchTo = useCallback(
    (to: Modality) => {
      void fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modality: to }),
      });
      router.push(`/disclosure/c/${chapter}?mode=${to}`);
    },
    [chapter, router],
  );

  // Nothing new left — only things set aside. Without a way out, skipping the
  // last question hands it straight back forever.
  const deferralEscape = inDeferralPass(answers) ? (
    <div className="mx-auto max-w-lg px-4 pt-4">
      <Link
        href="/disclosure/review"
        className="inline-flex min-h-11 items-center py-3 -my-2 text-sm font-medium text-brand-strong underline underline-offset-4"
      >
        That&rsquo;s everything I can answer &mdash; leave the rest for my agent
      </Link>
    </div>
  ) : null;

  /*
   * Features defaults to the form because forty checkboxes read aloud is
   * torture. But the mic affordance on that screen promises a way out, and a
   * promise the product will not keep is worse than no affordance at all.
   */
  if (modality === "voice") {
    return (
      <VoiceChapter
        chapter={chapter}
        onAdvance={advance}
        onSwitchToForm={() => switchTo("form")}
      />
    );
  }

  if (chapter === "features") {
    return (
      <>
        <ProgressHeader answers={answers} current={chapter} />
        {deferralEscape}
        <FeaturesChapter
          sellerName={sellerName}
          initialAnswers={answers}
          onWrote={absorb}
          onChapterDone={advance}
          onSwitchToVoice={() => switchTo("voice")}
        />
      </>
    );
  }

  return (
    <>
      <ProgressHeader answers={answers} current={chapter} />
      {deferralEscape}
      <QuestionList
        chapter={chapter}
        initialAnswers={answers}
        onWrote={absorb}
        onAdvance={advance}
        onSwitchToVoice={() => switchTo("voice")}
      />
    </>
  );
}
