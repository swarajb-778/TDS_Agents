/**
 * What counts as an acceptable password. One rule: length.
 *
 * No character classes, no "must contain a symbol". Composition rules are
 * counterproductive — told to add a digit and a capital, people produce
 * `Password1!`, which is both harder to remember and easier to guess than four
 * words. Length is the only requirement that reliably buys entropy, and it is
 * the only one NIST 800-63B still recommends.
 *
 * Client-safe by design, like csrf.ts: the signup, reset and settings forms all
 * import the same rule the server enforces, so the browser can say it before
 * the round trip and can never disagree with the answer that comes back.
 */

export const MIN_PASSWORD_LENGTH = 10;

/**
 * An upper bound, which is not a composition rule but a request-size guard:
 * scrypt is deliberately expensive, and an unbounded input makes the sign-in
 * endpoint a cheap way to burn our CPU. Far above anything a human types.
 */
export const MAX_PASSWORD_LENGTH = 512;

/** Returns the problem to show next to the field, or null if it's fine. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters. A few words you'll remember beats a short scramble.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `That's longer than ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
}
