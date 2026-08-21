import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentAgent } from "@/db/guard";
import { dealForAgent } from "@/db/deals";
import { loadAnswers } from "@/db/answers";
import { reviewConflicts } from "@/db/conflicts";
import { CHAPTERS, questionsInChapter } from "@/tds/registry";
import { agentQueue, deferredQuestions, isVisible, progress } from "@/tds/flow";
import { describeAnswer } from "@/tds/form-view";
import { Card, Pill } from "@/app/ui";
import { ReissueLink } from "./reissue";

export const dynamic = "force-dynamic";

export default async function DealReview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const agent = await currentAgent();
  if (!agent) redirect("/agent/login");

  const { id } = await params;
  const deal = await dealForAgent(id, agent.id);
  if (!deal) notFound();

  const answers = await loadAnswers(deal.id);
  const conflicts = await reviewConflicts(deal.id, answers);
  const p = progress(answers);
  const queue = agentQueue(answers);
  const deferred = deferredQuestions(answers);

  return (
    <>
      <Link href="/agent" className="text-sm font-medium text-brand-strong underline underline-offset-4">
        &larr; All disclosures
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{deal.sellerName}</h1>
          <p className="mt-1 text-ink-muted">{deal.propertyAddress}</p>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={p.overallPercent === 100 ? "positive" : "brand"}>
            {p.overallPercent}% complete
          </Pill>
          <ReissueLink dealId={deal.id} />
        </div>
      </div>

      {/* What the agent actually has to act on, before the full transcript. */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Card tone={queue.length ? "attention" : "plain"}>
          <p className="tabular text-2xl font-semibold">{queue.length}</p>
          <p className="text-sm text-ink-muted">Couldn&rsquo;t answer</p>
        </Card>
        <Card tone={conflicts.filter((c) => !c.acknowledged).length ? "attention" : "plain"}>
          <p className="tabular text-2xl font-semibold">
            {conflicts.filter((c) => !c.acknowledged).length}
          </p>
          <p className="text-sm text-ink-muted">Don&rsquo;t line up</p>
        </Card>
        <Card tone={deferred.length ? "attention" : "plain"}>
          <p className="tabular text-2xl font-semibold">{deferred.length}</p>
          <p className="text-sm text-ink-muted">Set aside</p>
        </Card>
      </div>

      {queue.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Needs you</h2>
          <p className="mt-1 text-sm text-ink-muted">
            The seller said they didn&rsquo;t know, or asked for you. These are
            normal &mdash; going through them together beats leaving them blank.
          </p>
          <ul className="mt-3 space-y-2">
            {queue.map((q) => {
              const a = answers[q.id];
              return (
                <Card as="li" key={q.id} tone="attention">
                  <p className="font-medium">{q.sellerLabel ?? q.label}</p>
                  <p className="mt-1 text-sm text-ink-muted">
                    {a?.status === "unknown" ? "Didn't know" : "Flagged for you"}
                    {a?.note ? ` — ${a.note}` : ""}
                  </p>
                  {a?.verbatim && (
                    <p className="mt-1 text-sm italic text-ink-faint">&ldquo;{a.verbatim}&rdquo;</p>
                  )}
                </Card>
              );
            })}
          </ul>
        </section>
      )}

      {conflicts.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Answers that don&rsquo;t line up</h2>
          <ul className="mt-3 space-y-2">
            {conflicts.map((c) => (
              <Card as="li" key={c.ruleId} tone={c.acknowledged ? "sunken" : "attention"}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 flex-1">{c.message}</p>
                  {c.acknowledged && <Pill tone="neutral">Seller stood by both</Pill>}
                </div>
                <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
                  {c.involves.map((qid) => {
                    const s = describeAnswer(qid, answers);
                    if (!s) return null;
                    return (
                      <div key={qid} className="text-sm">
                        <dt className="text-ink-faint">{s.label}</dt>
                        <dd className="font-medium">{s.value}</dd>
                      </div>
                    );
                  })}
                </dl>
              </Card>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Everything they answered</h2>
        {CHAPTERS.map((chapter) => {
          const visible = questionsInChapter(chapter.id).filter(
            (q) => isVisible(q, answers) && answers[q.id],
          );
          if (!visible.length) return null;
          return (
            <div key={chapter.id} className="mt-5">
              <h3 className="text-sm font-semibold tracking-wide text-ink-muted uppercase">
                {chapter.title}
              </h3>
              <Card className="mt-2 divide-y divide-line p-0">
                {visible.map((q) => {
                  const s = describeAnswer(q.id, answers);
                  const a = answers[q.id];
                  if (!s) return null;
                  return (
                    <div key={q.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2.5">
                      <p className="min-w-0 flex-1 text-sm text-ink-muted">{s.label}</p>
                      <p className="text-sm font-medium">{s.value}</p>
                      {/* Where it came from matters on a legal document. */}
                      <span className="text-xs text-ink-faint">
                        {a?.source === "voice" ? "spoken" : a?.source === "agent" ? "you" : "tapped"}
                      </span>
                      {a?.verbatim && (
                        <p className="w-full text-sm italic text-ink-faint">&ldquo;{a.verbatim}&rdquo;</p>
                      )}
                    </div>
                  );
                })}
              </Card>
            </div>
          );
        })}
      </section>
    </>
  );
}
