import Link from "next/link";
import { Button, Card } from "@/app/ui";
import { resolveAgentToken } from "@/db/agent-tokens";
import { AuthShell } from "../../auth-shell";
import { SignInButton } from "./sign-in-button";

export const dynamic = "force-dynamic";

/** The link a brand-new agent is emailed after signing up. Peeked, not spent. */
export default async function SignInLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const holder = await resolveAgentToken(token, "sign_in");

  if (!holder) {
    return (
      <AuthShell
        title="This link has expired"
        lead="Sign-in links work once and last half an hour."
      >
        <Card className="mt-6" tone="sunken">
          <p className="text-ink">
            No harm done &mdash; your account is there and the password you chose
            still works.
          </p>
          <Link href="/agent/login" className="mt-4 inline-block">
            <Button size="md">Sign in with your password</Button>
          </Link>
        </Card>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={`Welcome, ${holder.name.split(" ")[0]}`}
      lead={
        <>
          Signing you in as <span className="font-medium text-ink">{holder.email}</span>.
        </>
      }
      footer={
        <>
          Not you?{" "}
          <Link href="/agent/login" className="font-medium text-brand-strong underline">
            Sign in with a different account
          </Link>
        </>
      }
    >
      <SignInButton token={token} />
    </AuthShell>
  );
}
