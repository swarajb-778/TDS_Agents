"use client";

import { useRouter } from "next/navigation";
import type { AnswerMap } from "@/tds/types";
import { SignChapter } from "@/app/disclosure/_components/sign-chapter";

export function SignScreen({
  sellerName,
  answers,
}: {
  sellerName: string;
  answers: AnswerMap;
}) {
  const router = useRouter();
  return (
    <SignChapter
      sellerName={sellerName}
      answers={answers}
      onBack={() => router.push("/disclosure/review")}
    />
  );
}
