"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { nextQuestion } from "@/tds/flow";
import type { AnswerMap, ChapterId } from "@/tds/types";
import { FeaturesChapter } from "./features-chapter";
import { QuestionList } from "./question-list";
import { VoiceChapter } from "./voice-chapter";

/**
 * Picks the chapter and the input path.
 *
 * The chapter is derived from the answer set, never stored. The modality is a
 * default the seller can override at any point, in either direction — that
 * override is the whole reason both paths exist.
 */

interface Props {
  token: string;
  sellerName: string;
  initialAnswers: AnswerMap;
}

export function SellerFlow({ token, sellerName, initialAnswers }: Props) {
  const router = useRouter();
  const next = nextQuestion(initialAnswers);
  const chapter: ChapterId = next.chapter ?? "features";

  const suggested = next.question?.defaultModality === "voice" ? "voice" : "form";
  const [modality, setModality] = useState<"voice" | "form">(suggested);

  if (next.done) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <h1 className="text-2xl font-semibold">
          You&rsquo;re done, {sellerName.split(" ")[0]}.
        </h1>
        <p className="mt-3 text-stone-600">
          Everything&rsquo;s answered. Your agent will review it and send the form
          for signature.
        </p>
      </main>
    );
  }

  if (chapter === "features") {
    return (
      <FeaturesChapter
        token={token}
        sellerName={sellerName}
        initialAnswers={initialAnswers}
        onChapterDone={() => router.refresh()}
      />
    );
  }

  if (modality === "voice") {
    return (
      <VoiceChapter
        token={token}
        chapter={chapter}
        onSwitchToForm={() => setModality("form")}
      />
    );
  }

  return (
    <QuestionList
      token={token}
      chapter={chapter}
      initialAnswers={initialAnswers}
      onSwitchToVoice={() => setModality("voice")}
    />
  );
}
