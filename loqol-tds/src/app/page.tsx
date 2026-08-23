/**
 * The front door.
 *
 * Two audiences arrive at the root and neither of them typed it on purpose.
 * An agent bookmarked the app; a seller lost the email and reached for the bare
 * domain. So: if either is already signed in, this is a redirect and they never
 * see it. Only a genuine stranger gets a page, and what they need is one
 * obvious way in and an honest answer about the other.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { currentAgent } from "@/db/guard";
import { currentSeller } from "@/db/seller-guard";
import { AuthShell } from "./agent/auth-shell";

export const dynamic = "force-dynamic";

export default async function Home() {
  /*
   * Agent first, and it matters only for the one person who holds both cookies
   * at once: someone testing the seller flow while signed in. The agent is the
   * repeat visitor to this URL, and an agent bounced into a stale seller
   * session would have to sign out to reach their own dashboard. A seller never
   * has an agent cookie, so nothing real is traded away.
   *
   * Both guards read a cookie before they read the database, so a stranger
   * costs two cookie lookups and no query.
   */
  const agent = await currentAgent();
  if (agent) redirect("/agent");

  const seller = await currentSeller();
  if (seller.outcome === "valid" || seller.outcome === "submitted") {
    redirect("/disclosure");
  }

  return (
    <AuthShell
      title="Seller disclosures"
      lead="California Transfer Disclosure Statements, completed by the seller and signed online."
      /*
       * No link for the seller, deliberately. /disclosure/help can only revive
       * a session it can still identify, so a stranger sent there would meet a
       * "send me a new link" button that answers 409. The honest answer is that
       * only their agent can start this.
       */
      footer={
        <>
          <strong className="font-medium text-ink">Selling a home?</strong> There
          is no account to create — your agent emails you a link that takes you
          straight in.
        </>
      }
    >
      <div className="mt-8 flex flex-col gap-3">
        <Link
          href="/agent/login"
          className="inline-flex min-h-12 items-center justify-center rounded-control bg-brand px-4 font-medium text-on-brand transition-colors duration-150 hover:bg-brand-strong"
        >
          Sign in
        </Link>
        <Link
          href="/agent/signup"
          className="inline-flex min-h-12 items-center justify-center rounded-control border border-line-strong px-4 font-medium transition-colors duration-150 hover:bg-surface-sunken"
        >
          Create an agent account
        </Link>
      </div>
    </AuthShell>
  );
}
