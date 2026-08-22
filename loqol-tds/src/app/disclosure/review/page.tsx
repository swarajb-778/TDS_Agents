/**
 * Everything they said, before it is locked in.
 *
 * A real URL rather than a flag, so a seller who wants to check something can
 * come back here from the browser's own history instead of finishing the form
 * again to reach it.
 */

import { redirect } from "next/navigation";
import { sellerScreen } from "../session";
import { ReviewScreen } from "./review-screen";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const screen = await sellerScreen();
  if (screen.submittedAt) redirect("/disclosure");

  return (
    <ReviewScreen sellerName={screen.sellerName} answers={screen.answers} />
  );
}
