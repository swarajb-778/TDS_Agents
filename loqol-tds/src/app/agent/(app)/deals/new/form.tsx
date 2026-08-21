"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { Button, Card, Field, inputClass } from "@/app/ui";
import { csrfHeader } from "@/app/csrf";
import type { AnswerValue } from "@/tds/types";

interface AgentQuestion {
  id: string;
  label: string;
  hint?: string;
  type: string;
  options: Array<{ value: string; label: string }> | null;
  gatedBy: string | null;
}

export function NewDealForm({ questions }: { questions: AgentQuestion[] }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({
    "meta.date": new Date().toISOString().slice(0, 10),
    "meta.multi_unit": false,
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const set = (id: string, value: AnswerValue) =>
    setAnswers((prev) => ({ ...prev, [id]: value }));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const data = new FormData(event.currentTarget);
    try {
      const res = await fetch("/api/agent/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeader() },
        body: JSON.stringify({
          sellerName: data.get("sellerName"),
          sellerEmail: data.get("sellerEmail"),
          propertyAddress: data.get("propertyAddress"),
          answers: { ...answers, "meta.address": data.get("propertyAddress") },
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.fieldErrors) {
          setFieldErrors(json.fieldErrors);
          // Focus the first field that failed, rather than a summary far away.
          const first = Object.keys(json.fieldErrors)[0];
          document.getElementById(first)?.focus();
        } else {
          setError(json.error ?? "Could not create this disclosure.");
        }
        return;
      }
      setLink(json.link);
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  if (link) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold">Link ready</h1>
        <p className="mt-2 text-ink-muted">
          Send this to your seller. It works once, for 14 days, and only for this
          property. Nothing to sign up for.
        </p>
        <Card className="mt-5">
          <p className="text-sm font-medium text-ink-muted">Magic link</p>
          <p className="mt-1 break-all font-mono text-sm text-ink">{link}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              size="md"
              onClick={async () => {
                await navigator.clipboard.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 2500);
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Link href="/agent">
              <Button size="md" variant="secondary">
                Back to disclosures
              </Button>
            </Link>
          </div>
        </Card>
        <p className="mt-4 text-sm text-ink-faint">
          This is the only time the link is shown. You can always issue a fresh
          one from the seller&rsquo;s page.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">New disclosure</h1>
      <p className="mt-2 text-ink-muted">
        You fill in what your seller cannot reasonably know. They get the rest.
      </p>

      {error && (
        <p role="alert" className="mt-5 rounded-control bg-danger-surface px-3 py-2 text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <Card className="mt-6 space-y-5">
        <h2 className="font-semibold">Seller</h2>
        <Field label="Full name" htmlFor="sellerName" required error={fieldErrors.sellerName}>
          <input id="sellerName" name="sellerName" required autoComplete="off" className={inputClass} />
        </Field>
        <Field label="Email" htmlFor="sellerEmail" required error={fieldErrors.sellerEmail} hint="Where the disclosure link goes.">
          <input id="sellerEmail" name="sellerEmail" type="email" required autoComplete="off" className={inputClass} />
        </Field>
        <Field label="Property address" htmlFor="propertyAddress" required error={fieldErrors.propertyAddress}>
          <input id="propertyAddress" name="propertyAddress" required autoComplete="off" className={inputClass} />
        </Field>
      </Card>

      <Card className="mt-4 space-y-5">
        <div>
          <h2 className="font-semibold">Property details</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Nobody knows their own legal description. Asking a seller for it is
            how you lose them in the first thirty seconds.
          </p>
        </div>

        {questions
          .filter((q) => q.id !== "meta.address")
          .filter((q) => !q.gatedBy || answers[q.gatedBy] === true)
          .map((q) => (
            <Field key={q.id} label={q.label} htmlFor={q.id} hint={q.hint}>
              {q.type === "boolean" ? (
                <div className="flex gap-2">
                  {[true, false].map((v) => (
                    <button
                      key={String(v)}
                      type="button"
                      onClick={() => set(q.id, v)}
                      aria-pressed={answers[q.id] === v}
                      className={`min-h-11 flex-1 rounded-control border-2 px-4 text-sm font-medium transition-colors duration-150 ${
                        answers[q.id] === v
                          ? "border-brand bg-brand text-on-brand"
                          : "border-line-strong bg-surface text-ink"
                      }`}
                    >
                      {v ? "Yes" : "No"}
                    </button>
                  ))}
                </div>
              ) : q.type === "multi_enum" && q.options ? (
                <div className="flex flex-wrap gap-2">
                  {q.options.map((o) => {
                    const current = Array.isArray(answers[q.id]) ? (answers[q.id] as string[]) : [];
                    const on = current.includes(o.value);
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() =>
                          set(q.id, on ? current.filter((v) => v !== o.value) : [...current, o.value])
                        }
                        aria-pressed={on}
                        className={`min-h-11 rounded-control border-2 px-4 text-sm font-medium transition-colors duration-150 ${
                          on
                            ? "border-brand bg-brand text-on-brand"
                            : "border-line-strong bg-surface text-ink"
                        }`}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <input
                  id={q.id}
                  type={q.type === "date" ? "date" : "text"}
                  value={typeof answers[q.id] === "string" ? (answers[q.id] as string) : ""}
                  onChange={(e) => set(q.id, e.target.value)}
                  className={inputClass}
                />
              )}
            </Field>
          ))}
      </Card>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button type="submit" busy={busy}>
          {busy ? "Creating" : "Create and get link"}
        </Button>
        <Link href="/agent">
          <Button variant="secondary">Cancel</Button>
        </Link>
      </div>
    </form>
  );
}
