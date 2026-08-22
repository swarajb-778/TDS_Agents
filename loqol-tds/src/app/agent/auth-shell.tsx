/**
 * The frame around every signed-out agent screen.
 *
 * Sign in, sign up, forgot, reset and the emailed sign-in link are five pages
 * that are really one screen with different contents, and a person moving
 * between them mid-task should not feel the page jump. One shell keeps the
 * wordmark, width and rhythm identical across all five.
 */

import type { ReactNode } from "react";

export function AuthShell({
  title,
  lead,
  children,
  footer,
}: {
  title: string;
  lead?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-12"
    >
      <p className="text-sm font-semibold tracking-wide text-brand-strong uppercase">Loqol</p>
      <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
      {lead && <div className="mt-2 text-ink-muted">{lead}</div>}
      {children}
      {footer && <div className="mt-8 text-sm text-ink-muted">{footer}</div>}
    </main>
  );
}

/** Errors that belong to the whole form rather than to one field. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-control bg-danger-surface px-3 py-2 text-sm font-medium text-danger"
    >
      {children}
    </p>
  );
}
