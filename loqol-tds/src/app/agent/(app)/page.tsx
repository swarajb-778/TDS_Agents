import Link from "next/link";
import { redirect } from "next/navigation";
import { currentAgent } from "@/db/guard";
import { listDeals, type DealStatus } from "@/db/deals";
import { Button, Card, Pill } from "@/app/ui";

export const dynamic = "force-dynamic";

const STATUS: Record<DealStatus, { label: string; tone: "neutral" | "positive" | "attention" | "brand" }> = {
  draft: { label: "Not sent", tone: "neutral" },
  not_started: { label: "Sent, not opened", tone: "neutral" },
  in_progress: { label: "In progress", tone: "brand" },
  submitted: { label: "Submitted", tone: "positive" },
};

export default async function AgentDashboard() {
  const agent = await currentAgent();
  if (!agent) redirect("/agent/login");
  const deals = await listDeals(agent.id);

  const needingAttention = deals.filter((d) => d.needsAgent > 0 || d.conflicts > 0);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Disclosures</h1>
          <p className="mt-1 text-ink-muted">
            {deals.length === 0
              ? "No sellers yet."
              : `${deals.length} seller${deals.length === 1 ? "" : "s"}, ${needingAttention.length} needing you.`}
          </p>
        </div>
        <Link href="/agent/deals/new">
          <Button size="md">New disclosure</Button>
        </Link>
      </div>

      {deals.length === 0 ? (
        /* An empty state that says what to do, not just that there is nothing. */
        <Card className="mt-8 text-center">
          <h2 className="text-lg font-semibold">Start with one seller</h2>
          <p className="mx-auto mt-2 max-w-md text-ink-muted">
            You fill in the property details &mdash; county, legal description
            &mdash; then send a link. Your seller never creates an account.
          </p>
          <Link href="/agent/deals/new" className="mt-5 inline-block">
            <Button size="md">New disclosure</Button>
          </Link>
        </Card>
      ) : (
        <ul className="mt-6 space-y-3">
          {deals.map((deal) => {
            const status = STATUS[deal.status];
            return (
              <Card as="li" key={deal.id} className="transition-colors duration-150 hover:border-line-strong">
                <Link href={`/agent/deals/${deal.id}`} className="block">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">{deal.sellerName}</p>
                      <p className="truncate text-sm text-ink-muted">{deal.propertyAddress}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Status word, not just a colour. */}
                      <Pill tone={status.tone}>{status.label}</Pill>
                      {deal.conflicts > 0 && (
                        <Pill tone="attention">
                          {deal.conflicts} to check
                        </Pill>
                      )}
                      {deal.needsAgent > 0 && (
                        <Pill tone="attention">{deal.needsAgent} for you</Pill>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-3">
                    <div
                      className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken"
                      role="progressbar"
                      aria-valuenow={deal.percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${deal.sellerName}: ${deal.percent}% complete`}
                    >
                      <div
                        className="h-full rounded-full bg-brand transition-all duration-300"
                        style={{ width: `${deal.percent}%` }}
                      />
                    </div>
                    <span className="tabular w-12 text-right text-sm text-ink-muted">
                      {deal.percent}%
                    </span>
                  </div>
                </Link>
              </Card>
            );
          })}
        </ul>
      )}
    </>
  );
}
