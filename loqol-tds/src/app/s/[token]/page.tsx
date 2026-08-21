import { loadAnswers } from "@/db/answers";
import { resolveSellerToken } from "@/db/requests";
import { loadPreferences } from "@/db/sessions";
import { SellerFlow } from "./seller-flow";

// Every visit reads the seller's current answers, so nothing here is cacheable.
export const dynamic = "force-dynamic";

export default async function SellerPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await resolveSellerToken(token);

  if (!session) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <h1 className="text-2xl font-semibold">This link has expired</h1>
        <p className="mt-3 text-ink-muted">
          Disclosure links stop working after a couple of weeks, for your
          security. Your agent can send you a fresh one — nothing you already
          answered is lost.
        </p>
      </main>
    );
  }

  const [answers, preferences] = await Promise.all([
    loadAnswers(session.dealId),
    loadPreferences(session.dealId),
  ]);

  return (
    <SellerFlow
      token={token}
      sellerName={session.sellerName}
      initialAnswers={answers}
      initialModality={preferences.modality}
    />
  );
}
