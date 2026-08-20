/**
 * Nothing lives at the root yet. Sellers arrive on /s/<token>; the agent view
 * is task 6.
 */
export default function Home() {
  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold">Loqol</h1>
      <p className="mt-2 text-stone-600">
        Seller disclosures are reached through the link in your email.
      </p>
    </main>
  );
}
