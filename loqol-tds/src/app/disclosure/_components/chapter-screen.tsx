"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { inDeferralPass } from "@/tds/flow";
import type { AnswerMap, ChapterId, Modality } from "@/tds/types";
import { Pending } from "@/app/ui";
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
  /** Which question to point at on arrival. A view hint; see use-focus-question. */
  focusQuestionId?: string | null;
}

/**
 * The other path's answers, straight from the store.
 *
 * Voice writes land on the server, so the browser holding this component has
 * never seen them. Never fatal: a failed pull leaves what is already on screen
 * and the seller keeps going.
 */
async function pullAnswers(): Promise<AnswerMap | null> {
  try {
    const res = await fetch("/api/answers", { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()).answers ?? null) as AnswerMap | null;
  } catch {
    return null;
  }
}

export function ChapterScreen({
  chapter,
  modality,
  sellerName,
  initialAnswers,
  focusQuestionId,
}: Props) {
  const router = useRouter();
  const [answers, setAnswers] = useState<AnswerMap>(initialAnswers);
  const [pending, startTransition] = useTransition();
  /** Which path we are moving to, so the wait can say what it is waiting for. */
  const [handoff, setHandoff] = useState<Modality | null>(null);

  const absorb = useCallback((updated?: AnswerMap) => {
    if (updated) setAnswers(updated);
  }, []);

  /** Hand back to the dispatcher; it decides what comes next. */
  const advance = useCallback(() => {
    setHandoff(null);
    startTransition(() => {
      // The chapter just ended, quite possibly by voice, so the dispatcher must
      // read the answers rather than a payload cached before any of them
      // existed — it is choosing the next chapter from them.
      router.refresh();
      router.push("/disclosure");
    });
  }, [router]);

  /**
   * Switching path is a navigation now, which is the point: it survives a
   * refresh and a back button. The preference is still recorded, because it is
   * an actual choice and re-entry should honour it.
   *
   * The seller arrives carrying two things. Their answers: pulled from the
   * store first, because voice wrote them on the server and this browser has
   * only ever seen the map it was handed at page load — rendering the form from
   * that map is how a seller who has just said "yes, there's a fire alarm" gets
   * shown an untouched fire alarm chip. And their place: `?q=`, so a fifty-
   * question chapter opens where they were rather than at the top.
   *
   * Both happen inside one transition, so the wait is a wait and not a flash of
   * the state they just left. router.refresh() is in it as well, because the
   * page that renders next derives from the answers too — which questions are
   * visible, whether the chapter still has anything in it at all.
   */
  const switchTo = useCallback(
    (to: Modality, questionId?: string) => {
      setHandoff(to);
      void fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modality: to }),
      });

      const place = questionId ? `&q=${encodeURIComponent(questionId)}` : "";
      startTransition(async () => {
        router.refresh();
        const fresh = await pullAnswers();
        if (fresh) setAnswers(fresh);
        router.push(`/disclosure/c/${chapter}?mode=${to}${place}`);
      });
    },
    [chapter, router],
  );

  /*
   * A switch is a handover, and a handover that shows the old screen for two
   * seconds looks like a tap that did nothing. Reachable only while the
   * transition is in flight, so a navigation that never resolves falls back to
   * the screen the seller was already on rather than stranding them here.
   *
   * Both callers stop the microphone before they call switchTo, so nothing is
   * torn down mid-call by rendering this.
   */
  if (pending && handoff) {
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center px-4">
        <Pending
          label={
            handoff === "form"
              ? "Bringing up everything you’ve told me…"
              : "Getting ready to talk it through…"
          }
        />
      </main>
    );
  }

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
        /*
         * Voice hands back the question it was on. Nothing goes the other way:
         * a spoken conversation has no scroll position to restore, and the
         * first question of a call is chosen by flow.ts from the answers — a
         * `?q=` the agent then ignored would be a promise the product breaks.
         */
        onSwitchToForm={(questionId) => switchTo("form", questionId)}
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
          focusQuestionId={focusQuestionId}
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
        focusQuestionId={focusQuestionId}
        onWrote={absorb}
        onAdvance={advance}
        onSwitchToVoice={() => switchTo("voice")}
      />
    </>
  );
}
