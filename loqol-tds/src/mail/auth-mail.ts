/**
 * The three messages the agent account flow sends.
 *
 * They live together because they are a set: two of them are the two branches
 * of the same signup request, and the whole point is that the person who
 * triggered it cannot tell which one was sent. Writing them side by side is the
 * only way to keep that property visible.
 *
 * Copy rule: never confirm or deny that an address has an account to anyone but
 * the mailbox holder. "Someone tried to sign up with your address" is safe —
 * it is only ever read by the owner of that address.
 */

import { sendEmail } from "./send";

const FROM_PRODUCT = "Loqol Disclosures";

/**
 * Branch one of signup: the address was free, the account now exists.
 *
 * The link signs them in without retyping the password they just chose. It is
 * single-use and short-lived; if they miss it, the password works at the sign-in
 * page as normal, so a missed link is never a dead end.
 */
export function sendSignInLink(
  to: string,
  name: string,
  link: string,
  minutes: number,
): Promise<void> {
  return sendEmail({
    to,
    subject: `${FROM_PRODUCT}: finish setting up your account`,
    body: [
      `Hi ${name},`,
      "",
      "Your Loqol account is ready. Open this link to sign in:",
      "",
      `  ${link}`,
      "",
      `The link works once and expires in ${minutes} minutes. After that, sign`,
      "in with the email and password you just chose.",
      "",
      "If you didn't do this, you can ignore this message — nobody can use the",
      "account without the password.",
    ].join("\n"),
  });
}

/**
 * Branch two of signup: the address already has an account.
 *
 * The request came from someone who may not be the owner, so the response to
 * *them* says nothing. This message goes to the mailbox instead, which is the
 * one place the fact is not a leak — and it is useful, because the overwhelming
 * majority of the time this is the owner who forgot they had signed up.
 */
export function sendSignupCollision(to: string, signInUrl: string, resetUrl: string): Promise<void> {
  return sendEmail({
    to,
    subject: `${FROM_PRODUCT}: someone tried to sign up with your address`,
    body: [
      "Someone just tried to create a Loqol account with this email address.",
      "",
      "You already have one, so nothing was created and nothing has changed.",
      "",
      "If that was you, sign in here instead:",
      "",
      `  ${signInUrl}`,
      "",
      "If you've forgotten your password, you can set a new one:",
      "",
      `  ${resetUrl}`,
      "",
      "If it wasn't you, there is nothing to do. Your password still works and",
      "was never shown to whoever made the request.",
    ].join("\n"),
  });
}

/** The password-reset link itself. */
export function sendPasswordReset(
  to: string,
  name: string,
  link: string,
  minutes: number,
): Promise<void> {
  return sendEmail({
    to,
    subject: `${FROM_PRODUCT}: set a new password`,
    body: [
      `Hi ${name},`,
      "",
      "Open this link to choose a new password:",
      "",
      `  ${link}`,
      "",
      `It works once and expires in ${minutes} minutes.`,
      "",
      "If you didn't ask for this, ignore this message. Your current password",
      "keeps working and the link above stops working on its own.",
    ].join("\n"),
  });
}

/**
 * After the fact, to the address that owns the account.
 *
 * The one notification nobody can turn into an oracle — it is sent only to an
 * address that has just been proven to control the account, and it is the only
 * way the owner finds out if someone else got in.
 */
export function sendPasswordChanged(to: string, name: string, resetUrl: string): Promise<void> {
  return sendEmail({
    to,
    subject: `${FROM_PRODUCT}: your password was changed`,
    body: [
      `Hi ${name},`,
      "",
      "The password on your Loqol account was just changed, and any outstanding",
      "reset links were cancelled.",
      "",
      "If that wasn't you, set a new password immediately:",
      "",
      `  ${resetUrl}`,
    ].join("\n"),
  });
}
