/**
 * Client-safe constants.
 *
 * These live apart from db/auth.ts because the browser needs the header and
 * cookie NAMES to echo the CSRF token — importing them from the auth module
 * would drag the Postgres driver into the client bundle.
 */
export const CSRF_COOKIE = "loqol_csrf";
export const CSRF_HEADER = "x-csrf-token";

export function csrfHeader(): Record<string, string> {
  const value =
    document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${CSRF_COOKIE}=`))
      ?.split("=")[1] ?? "";
  return { [CSRF_HEADER]: value };
}
