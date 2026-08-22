/**
 * The end of a link that did not work — and never a dead end.
 *
 * There used to be one screen here, "This link has expired", shown for four
 * different reasons. Three of those were a lie, and a lie is worse than an
 * error: a seller told the wrong thing takes the wrong action, or none.
 *
 * So each outcome gets its own copy and its own working next step. The outcome
 * itself is derived server-side from the session cookie, not read off the URL,
 * so nothing here can be spoofed into offering an action it should not.
 *
 * Note the asymmetry with the agent side, which returns notFound() for a deal
 * that is not theirs. That is deliberate. An authenticated agent poking at deal
 * ids is enumerating; a seller with a broken link is confused. Enumeration is
 * answered with a blank wall, confusion with an explanation.
 */

import { redirect } from "next/navigation";
import { currentSeller } from "@/db/seller-guard";
import { Card } from "@/app/ui";
import { RequestNewLink } from "./request-new-link";

export const dynamic = "force-dynamic";

export default async function DisclosureHelp() {
  const access = await currentSeller();

  // They are fine. Nothing to help with.
  if (access.outcome === "valid" || access.outcome === "submitted") {
    redirect("/disclosure");
  }

  if (access.outcome === "revoked") {
    return (
      <Shell
        title="There's a newer link for you"
        lead="Your agent sent a fresh one, which switched this one off. It'll be the most recent email from them — check there first."
      >
        <Card tone="sunken">
          <p className="text-sm text-ink-muted">
            Nothing you already answered is lost. The new link picks up exactly
            where you left off.
          </p>
        </Card>
        <RequestNewLink
          label="I can't find that email — send another"
          variant="secondary"
        />
      </Shell>
    );
  }

  if (access.outcome === "expired") {
    return (
      <Shell
        title="This link has expired"
        lead="Disclosure links stop working after a couple of weeks, for your security. Getting a new one takes a second."
      >
        <RequestNewLink label="Send me a new link" variant="primary" />
        <Card tone="sunken">
          <p className="text-sm text-ink-muted">
            Everything you already answered is still saved. The new link starts
            you where you stopped.
          </p>
        </Card>
      </Shell>
    );
  }

  /*
   * not_found — which is also what a mangled link looks like, and by far the
   * likelier of the two. Mail clients wrap long URLs onto a second line and
   * only the first half becomes clickable, so the address that arrives here is
   * a real link with its tail missing. Say that, because "not found" would send
   * someone hunting for a problem that is two lines above their thumb.
   */
  return (
    <Shell
      title="This link looks incomplete"
      lead="Long links sometimes get split across two lines in an email, and only the first half opens."
    >
      <Card tone="sunken">
        <ol className="space-y-3 text-sm text-ink">
          <li>
            <span className="font-medium">Go back to the email</span> from your
            agent and tap the link there rather than a copy of it.
          </li>
          <li>
            <span className="font-medium">If it still won&rsquo;t open,</span>{" "}
            press and hold the link, copy it, and paste the whole thing into
            your browser&rsquo;s address bar.
          </li>
          <li>
            <span className="font-medium">Still stuck?</span> Reply to that
            email and ask your agent to send it again &mdash; it&rsquo;s a
            thirty-second job for them.
          </li>
        </ol>
      </Card>
      <p className="text-sm text-ink-faint">
        Nothing you&rsquo;ve already answered is lost, and none of this is your
        fault.
      </p>
    </Shell>
  );
}

function Shell({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <main id="main" className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-3 text-ink-muted">{lead}</p>
      <div className="mt-6 space-y-4">{children}</div>
    </main>
  );
}
