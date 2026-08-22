import Link from "next/link";
import { Button, Card } from "@/app/ui";
import { resolveAgentToken } from "@/db/agent-tokens";
import { AuthShell } from "../../auth-shell";
import { ResetForm } from "./reset-form";

/*
 * The token is in the URL, so nothing on this page may be cached or
 * prerendered — and the answer depends on a row that changes underneath it.
 */
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  /*
   * Peeked, not spent. Rendering this page must not burn the link — mail
   * clients prefetch, people open the email twice, and a token consumed by a
   * page load is a reset that never happens. It is spent by the POST the form
   * makes, once.
   */
  const holder = await resolveAgentToken(token, "password_reset");

  if (!holder) {
    return (
      <AuthShell
        title="This link has expired"
        lead="Reset links work once and last half an hour. Nothing has changed on your account."
      >
        <Card className="mt-6" tone="sunken">
          <p className="text-ink">
            Ask for a fresh one &mdash; it takes a moment, and your current
            password still works in the meantime.
          </p>
          <Link href="/agent/forgot-password" className="mt-4 inline-block">
            <Button size="md">Email me a new link</Button>
          </Link>
        </Card>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      lead={
        <>
          For <span className="font-medium text-ink">{holder.email}</span>. Any
          other reset links you have will stop working.
        </>
      }
      footer={
        <Link href="/agent/login" className="font-medium text-brand-strong underline">
          Back to sign in
        </Link>
      }
    >
      <ResetForm token={token} />
    </AuthShell>
  );
}
