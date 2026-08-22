/**
 * One chapter of the interview.
 *
 * Chapter-level and not question-level, deliberately. A URL per question would
 * tear down the WebRTC voice session on every answer, and a chapter boundary is
 * a natural pause in a spoken conversation anyway. The back button still works
 * at a granularity that means something.
 */

import { redirect } from "next/navigation";
import { CHAPTERS } from "@/tds/registry";
import { questionsInChapter } from "@/tds/registry";
import { isVisible } from "@/tds/flow";
import { focusableQuestion } from "@/tds/form-view";
import type { ChapterId, Modality } from "@/tds/types";
import { ChapterScreen } from "@/app/disclosure/_components/chapter-screen";
import { sellerScreen } from "../../session";

export const dynamic = "force-dynamic";

function isChapter(value: string): value is ChapterId {
  return CHAPTERS.some((c) => c.id === value);
}

export default async function Chapter({
  params,
  searchParams,
}: {
  params: Promise<{ chapterId: string }>;
  searchParams: Promise<{ mode?: string; q?: string }>;
}) {
  const [{ chapterId }, { mode, q }] = await Promise.all([params, searchParams]);
  const screen = await sellerScreen();

  if (screen.submittedAt) redirect("/disclosure");
  // A hand-typed or stale chapter is not an error worth a page of its own —
  // the dispatcher knows where they actually belong.
  if (!isChapter(chapterId)) redirect("/disclosure");

  const visible = questionsInChapter(chapterId).filter(
    (q) => q.defaultModality !== "agent" && isVisible(q, screen.answers),
  );
  // Nothing to ask here — a gate upstream closed the whole chapter.
  if (visible.length === 0) redirect("/disclosure");

  /*
   * The URL wins over the stored preference, because it is the more recent
   * expression of intent: the seller either followed a link that named a mode
   * or tapped "show me the buttons". Absent both, the registry decides.
   */
  const fromUrl: Modality | null =
    mode === "voice" || mode === "form" ? mode : null;
  const suggested: Modality =
    visible[0].defaultModality === "voice" ? "voice" : "form";
  const modality = fromUrl ?? screen.modality ?? suggested;

  /*
   * `?q=` is the other half of the handoff: which question the seller was on
   * when they left the other path. It is a view hint and nothing more — it
   * never enters the queue, and an id that no longer means anything resolves to
   * null rather than to an error page.
   */
  const focus = focusableQuestion(
    chapterId,
    typeof q === "string" ? q : null,
    screen.answers,
  );

  return (
    <ChapterScreen
      chapter={chapterId}
      modality={modality}
      sellerName={screen.sellerName}
      initialAnswers={screen.answers}
      focusQuestionId={focus}
    />
  );
}
