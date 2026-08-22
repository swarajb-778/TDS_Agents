/**
 * What the seller signed, read only.
 *
 * Reached by clicking the magic link after the disclosure has gone in. It is
 * not an error state and it does not look like one: the seller put an hour
 * into a legal document and the least the link can do afterwards is show them
 * their own copy of it.
 *
 * Everything is projected from the registry — labels via `sellerLabel`, values
 * via `describeAnswer` — so nothing here can drift from what was actually
 * submitted.
 */

import { CHAPTERS, CHAPTER_ORDER, getChapter, questionsInChapter } from "@/tds/registry";
import { agentQueue, isVisible } from "@/tds/flow";
import { describeAnswer } from "@/tds/form-view";
import type { AnswerMap } from "@/tds/types";
import { Card, Pill } from "@/app/ui";
import { AfterSigning } from "@/app/disclosure/_components/after-signing";

interface Props {
  sellerName: string;
  propertyAddress: string;
  submittedAt: Date;
  answers: AnswerMap;
}

const DATE = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
  timeStyle: "short",
});

export function Submitted({
  sellerName,
  propertyAddress,
  submittedAt,
  answers,
}: Props) {
  const forAgent = agentQueue(answers);

  const chapters = CHAPTER_ORDER.map((id) => ({
    chapter: getChapter(id) ?? CHAPTERS[0],
    questions: questionsInChapter(id).filter(
      (q) => isVisible(q, answers) && answers[q.id],
    ),
  })).filter((c) => c.questions.length > 0);

  return (
    <main id="main" className="mx-auto max-w-lg px-4 py-10">
      <Pill tone="positive">
        <span aria-hidden="true">&#10003;</span> Sent to your agent
      </Pill>

      <h1 className="mt-4 text-2xl font-semibold">
        You&rsquo;re done, {sellerName.split(" ")[0]}.
      </h1>
      <p className="mt-2 text-ink-muted">{propertyAddress}</p>
      <p className="mt-1 text-sm text-ink-faint">
        Submitted {DATE.format(submittedAt)}
      </p>
      <p className="mt-4 text-ink-muted">
        This is your copy. Nothing here can be changed now &mdash; that&rsquo;s
        what makes a signature mean something.
      </p>

      {/*
        The signed PDF, what happens next, and "I need to change something".
        Shared with the signing step so a seller who comes back through their
        link a week later gets exactly what they got the moment they signed.
      */}
      <AfterSigning />

      {forAgent.length > 0 && (
        <Card tone="sunken" className="mt-6">
          <p className="text-sm font-medium text-ink">
            {forAgent.length} thing{forAgent.length === 1 ? "" : "s"} your agent
            is finishing with you
          </p>
          <ul className="mt-2 space-y-1">
            {forAgent.map((q) => (
              <li key={q.id} className="text-sm text-ink-muted">
                &middot; {q.sellerLabel ?? q.label}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {chapters.map(({ chapter, questions }) => (
        <section key={chapter.id} className="mt-8">
          <h2 className="text-lg font-semibold">{chapter.title}</h2>
          <dl className="mt-3 divide-y divide-line rounded-card border border-line bg-surface">
            {questions.map((q) => {
              const summary = describeAnswer(q.id, answers);
              if (!summary) return null;
              return (
                <div
                  key={q.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
                >
                  <dt className="text-sm text-ink-muted">{summary.label}</dt>
                  <dd className="text-base font-medium text-ink">
                    {summary.value}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}

      <p className="mt-10 text-sm text-ink-faint">
        Keep this link if you want to look at it again. It stops working once
        the sale closes.
      </p>
    </main>
  );
}
