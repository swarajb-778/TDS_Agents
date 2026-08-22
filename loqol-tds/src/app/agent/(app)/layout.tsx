import Link from "next/link";
import { redirect } from "next/navigation";
import { currentAgent } from "@/db/guard";
import { SignOut } from "./sign-out";

/*
 * Guards the (app) route group only. /agent/login deliberately sits outside it:
 * a guard that also covered the login page would redirect it to itself forever.
 */
export const dynamic = "force-dynamic";

export default async function AgentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const agent = await currentAgent();
  if (!agent) redirect("/agent/login");

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <Link href="/agent" className="flex items-baseline gap-2">
            <span className="text-sm font-semibold tracking-wide text-brand-strong uppercase">
              Loqol
            </span>
            <span className="text-sm text-ink-muted">Disclosures</span>
          </Link>
          <div className="flex items-center gap-3">
            {/* The name is the way into settings — the convention every app
                this sits beside already uses. */}
            <Link
              href="/agent/settings"
              className="inline-flex min-h-11 items-center text-sm text-ink-muted underline decoration-transparent transition-colors duration-150 hover:text-ink hover:decoration-current"
            >
              {/* The name where there is room for it, a word where there
                  isn't — settings must not be unreachable on a phone. */}
              <span className="hidden sm:inline">{agent.name}</span>
              <span className="sm:hidden">Account</span>
            </Link>
            <SignOut />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-5 py-8">
        {children}
      </main>
    </div>
  );
}
