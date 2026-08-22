/**
 * The seller's disclosure, with no token in the URL.
 *
 * Everything here comes from the session cookie set by `/s/[token]`. The route
 * is deliberately boring to look at and impossible to guess your way into: with
 * no cookie it is not a 404, it is the help page, because a stressed person at
 * 10pm who hits "Not Found" is gone from the transaction.
 */

import { redirect } from "next/navigation";
import { loadAnswers } from "@/db/answers";
import { currentSeller } from "@/db/seller-guard";
import { loadPreferences } from "@/db/sessions";
import { SellerFlow } from "@/app/s/[token]/seller-flow";
import { Submitted } from "./submitted";

// Every visit reads the seller's current answers, so nothing here is cacheable.
export const dynamic = "force-dynamic";

export default async function DisclosurePage() {
  const access = await currentSeller();

  // Not a 404 and not "expired". The help page works out which of the five
  // outcomes this actually is and gives it a working next step.
  if (access.outcome !== "valid" && access.outcome !== "submitted") {
    redirect("/disclosure/help");
  }

  const answers = await loadAnswers(access.session.dealId);

  if (access.outcome === "submitted") {
    return (
      <Submitted
        sellerName={access.session.sellerName}
        propertyAddress={access.session.propertyAddress}
        submittedAt={access.submittedAt}
        answers={answers}
      />
    );
  }

  const preferences = await loadPreferences(access.session.dealId);

  /*
   * SellerFlow and its children still thread a `token` prop into their fetches.
   * It is now inert — every seller endpoint authenticates from the cookie and
   * ignores the field — and passing the empty string rather than the real token
   * is the whole point of this change: the credential must not reach the client
   * bundle or the query strings in an access log. The prop stays because
   * removing it is a change to components another task owns.
   */
  return (
    <SellerFlow
      token=""
      sellerName={access.session.sellerName}
      initialAnswers={answers}
      initialModality={preferences.modality}
    />
  );
}
