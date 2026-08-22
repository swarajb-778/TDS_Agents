import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentAgent } from "@/db/guard";
import { dealForAgent } from "@/db/deals";
import { loadAnswers } from "@/db/answers";
import { reviewConflicts } from "@/db/conflicts";
import { CHAPTERS, questionsInChapter } from "@/tds/registry";
import { agentQueue, deferredQuestions, isVisible, progress } from "@/tds/flow";
import { describeAnswer } from "@/tds/form-view";
import { Button, Card, Pill } from "@/app/ui";
import { refreshSigning } from "@/db/signings";
import { ReissueLink } from "./reissue";

export const dynamic = "force-dynamic";

const SIGNED_AT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
  timeStyle: "short",
});

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
  // Reconciled against DocuSeal, not just read back. The agent is the person
  // who gets asked "did it go through?", and a page that only knows what a
  // webhook told it will confidently say no when the answer is yes.
  const signature = await refreshSigning(deal.id);

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
          {signature.state === "signed" ? (
            <Pill tone="positive">
              <span aria-hidden="true">&#10003;</span> Signed
            </Pill>
          ) : (
            <Pill tone={p.overallPercent === 100 ? "positive" : "brand"}>
              {p.overallPercent}% complete
            </Pill>
          )}
          <ReissueLink dealId={deal.id} />
        </div>
      </div>

      {/*
        The signature. The only thing on this page that is a fact about the
        outside world rather than a projection of the answer set — so it says
        where the document actually is, and links to the executed PDF rather
        than describing one.
      */}
      <Card tone={signature.changeRequest ? "attention" : "plain"} className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="font-medium">
              {signature.state === "signed"
                ? "Seller has signed"
                : signature.state === "awaiting_signature"
                  ? "Waiting on the seller's signature"
                  : "Not sent for signature yet"}
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              {signature.state === "signed" && signature.signedAt
                ? `${SIGNED_AT.format(signature.signedAt)}. You countersign in DocuSeal; the seller's answers are locked.`
                : signature.state === "awaiting_signature"
                  ? "They've opened the form. Nothing to do until they finish."
                  : !signature.configured
                    ? "DocuSeal isn't configured on this deployment."
                    : "The seller signs at the end of their interview."}
            </p>
          </div>
          {signature.state === "signed" && (
            <Button
              size="md"
              variant="secondary"
              href={`/api/agent/deals/${deal.id}/document`}
              download
            >
              Download the signed PDF
            </Button>
          )}
        </div>

        {signature.changeRequest && (
          <div className="mt-4 border-t border-attention-line pt-4">
            <p className="font-medium">The seller wants to change something.</p>
            {signature.changeRequest.note && (
              <p className="mt-2 text-sm italic text-ink-muted">
                &ldquo;{signature.changeRequest.note}&rdquo;
              </p>
            )}
            <p className="mt-2 text-sm text-ink-muted">
              Asked {SIGNED_AT.format(signature.changeRequest.at)}. A signed
              disclosure is not editable &mdash; send a fresh link above and
              they&rsquo;ll sign a corrected one. This clears when you do.
            </p>
          </div>
        )}
      </Card>

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
