import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/app/ui";
import { currentAgent } from "@/db/guard";
import { SignOut } from "../sign-out";
import { NameForm, PasswordForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  // The layout already guards this group; repeated here because the page reads
  // the agent, and a page that assumes its layout ran is a page that breaks the
  // day someone moves it.
  const agent = await currentAgent();
  if (!agent) redirect("/agent/login");

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">Your account</h1>
      <p className="mt-1 text-ink-muted">
        <Link href="/agent" className="font-medium text-brand-strong underline">
          Back to disclosures
        </Link>
      </p>

      <div className="mt-6 space-y-4">
        <Card as="section" tone="sunken">
          <h2 className="text-lg font-semibold">Email</h2>
          <p className="mt-1 text-ink">{agent.email}</p>
          {/*
            Not editable, and that is a decision rather than an omission. An
            address change is a second account-takeover surface: it needs
            confirmation at both the old and new mailbox to be safe, and doing
            it unconfirmed would let anyone with a borrowed session quietly
            move the account somewhere they control.
          */}
          <p className="mt-2 text-sm text-ink-muted">
            Changing the address on an account needs confirming at both the old
            and the new mailbox, so it isn&rsquo;t self-serve yet. Ask us and
            we&rsquo;ll move it.
          </p>
        </Card>

        <NameForm name={agent.name} />
        <PasswordForm />

        <Card as="section">
          <h2 className="text-lg font-semibold">Sign out</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Ends this session on this device. Your sellers&rsquo; links are
            unaffected &mdash; they never signed in to begin with.
          </p>
          <div className="mt-4">
            <SignOut />
          </div>
        </Card>
      </div>
    </div>
  );
}
