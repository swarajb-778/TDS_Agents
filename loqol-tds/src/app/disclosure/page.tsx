/**
 * The dispatcher. It renders nothing.
 *
 * Position stays derived from the answers — the URL is a view of that, not a
 * second source of truth that could disagree with it. So every "where do I go
 * next" question in the seller flow is answered here, on the server, against
 * freshly loaded answers, and the seller is redirected. Finishing a chapter
 * just navigates here and this works out the rest.
 */

import { redirect } from "next/navigation";
import { nextQuestion } from "@/tds/flow";
import { sellerScreen } from "./session";
import { Submitted } from "./submitted";

export const dynamic = "force-dynamic";

export default async function DisclosureDispatcher() {
  const screen = await sellerScreen();

  if (screen.submittedAt) {
    return (
      <Submitted
        sellerName={screen.sellerName}
        propertyAddress={screen.propertyAddress}
        submittedAt={screen.submittedAt}
        answers={screen.answers}
      />
    );
  }

  const next = nextQuestion(screen.answers);
  if (next.done || !next.chapter) redirect("/disclosure/review");
  redirect(`/disclosure/c/${next.chapter}`);
}
