"use client";

import { useRouter } from "next/navigation";
import type { AnswerMap } from "@/tds/types";
import { Review } from "@/app/disclosure/_components/review";

/** Wires the review card's two exits to real navigations. */
export function ReviewScreen({
  sellerName,
  answers,
}: {
  sellerName: string;
  answers: AnswerMap;
}) {
  const router = useRouter();
  return (
    <Review
      sellerName={sellerName}
      answers={answers}
      // "Change an answer" hands back to the dispatcher, which works out which
      // chapter still wants them rather than guessing here.
      onRevisit={() => router.push("/disclosure")}
      onSign={() => router.push("/disclosure/sign")}
    />
  );
}
