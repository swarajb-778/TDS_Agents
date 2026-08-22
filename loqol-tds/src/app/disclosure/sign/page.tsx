/**
 * The signature step.
 *
 * Its own URL so that "I need to change something" after signing, and any
 * agent-side link to the executed document, both have somewhere real to point.
 */

import { redirect } from "next/navigation";
import { sellerScreen } from "../session";
import { SignScreen } from "./sign-screen";

export const dynamic = "force-dynamic";

export default async function SignPage() {
  const screen = await sellerScreen();
  if (screen.submittedAt) redirect("/disclosure");

  return <SignScreen sellerName={screen.sellerName} answers={screen.answers} />;
}
