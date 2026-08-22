/**
 * First screen after the magic link.
 *
 * Reached only from the token exchange — never when advancing between
 * chapters, which goes through the dispatcher. Otherwise a seller would be
 * welcomed back every time they finished a part.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { deferredQuestions, nextQuestion, resume } from "@/tds/flow";
import { Button, Card } from "@/app/ui";
import { sellerScreen } from "../session";

export const dynamic = "force-dynamic";

export default async function Welcome() {
  const screen = await sellerScreen();
  if (screen.submittedAt) redirect("/disclosure");

  const next = nextQuestion(screen.answers);
  if (next.done || !next.chapter) redirect("/disclosure/review");

  const state = resume(screen.answers, screen.modality ?? "form");
  const deferred = deferredQuestions(screen.answers);
  const firstName = screen.sellerName.split(" ")[0];

  // The registry decides where they land unless they have chosen otherwise.
  const suggested = next.question?.defaultModality === "voice" ? "voice" : "form";
  const landing = screen.modality ?? suggested;
  const other = landing === "voice" ? "form" : "voice";

  return (
    <main id="main" className="mx-auto max-w-lg px-4 py-16">
      <h1 className="text-2xl font-semibold">
        {state.chapterTitle ? `Welcome back, ${firstName}.` : `Hi ${firstName}.`}
      </h1>
      <p className="mt-3 text-ink-muted">{state.message}</p>

      {deferred.length > 0 && (
        <Card className="mt-4 text-sm text-ink-muted">
          {deferred.length} thing{deferred.length === 1 ? "" : "s"} you asked to
          come back to {deferred.length === 1 ? "is" : "are"} still waiting
          &mdash; {deferred.length === 1 ? "it" : "they"}&rsquo;ll come round
          again at the end.
        </Card>
      )}

      <Link href={`/disclosure/c/${next.chapter}?mode=${landing}`} className="mt-6 block">
        <Button full>
          {state.chapterTitle ? "Pick up where I left off" : "Let's go"}
        </Button>
      </Link>

      {/* Modality is a default, not a jail — offered before they even start. */}
      <Link href={`/disclosure/c/${next.chapter}?mode=${other}`} className="mt-3 block">
        <Button full variant="secondary" size="md">
          {other === "form" ? "I'd rather tap than talk" : "I'd rather talk it through"}
        </Button>
      </Link>
    </main>
  );
}
