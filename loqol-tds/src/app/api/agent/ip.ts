/**
 * Whose request this is, for rate-limiting purposes.
 *
 * `x-forwarded-for` is the platform's header, not the caller's — behind no
 * proxy it is absent and everyone shares one bucket, which only tightens the
 * limit. Same treatment as the sign-in route, kept in one place now that four
 * endpoints need it.
 */
export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}
