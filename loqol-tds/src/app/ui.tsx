/**
 * Shared primitives.
 *
 * Both surfaces use these so the seller's form and the agent's dashboard stay
 * one product. Every interactive element here clears 44px, carries a visible
 * focus ring from globals.css, and animates within 150-200ms.
 */

import type { ReactNode } from "react";

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  /** One primary action per screen; everything else is subordinate. */
  variant?: "primary" | "secondary" | "quiet" | "danger";
  size?: "md" | "lg";
  full?: boolean;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
  "aria-label"?: string;
  /**
   * Renders an anchor instead of a button.
   *
   * For actions that really are navigations — downloading the signed PDF,
   * opening the signing page in its own tab. A button that navigates loses
   * middle-click, "save link as", and the browser's own download handling,
   * which is exactly what those two need.
   */
  href?: string;
  download?: boolean;
  /** Anchors only. Always paired with rel="noopener" below. */
  newTab?: boolean;
};

const VARIANT = {
  primary:
    "bg-brand text-on-brand hover:bg-brand-strong active:bg-brand-strong border-transparent",
  secondary:
    "bg-surface text-ink border-line-strong hover:bg-surface-sunken active:bg-surface-sunken",
  quiet:
    "bg-transparent text-ink-muted border-transparent hover:bg-surface-sunken hover:text-ink",
  danger:
    "bg-surface text-danger border-line-strong hover:bg-danger-surface active:bg-danger-surface",
} as const;

export function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  size = "lg",
  full,
  disabled,
  busy,
  className = "",
  href,
  download,
  newTab,
  ...rest
}: ButtonProps) {
  const shape = `inline-flex items-center justify-center gap-2 rounded-control border-2 font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 ${
    size === "lg" ? "min-h-14 px-5 text-base" : "min-h-11 px-4 text-sm"
  } ${full ? "w-full" : ""} ${VARIANT[variant]} ${className}`;

  if (href) {
    return (
      <a
        href={href}
        download={download}
        target={newTab ? "_blank" : undefined}
        // Never without noopener: the opened page gets no handle on this one.
        rel={newTab ? "noopener noreferrer" : undefined}
        className={shape}
        {...rest}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={shape}
      {...rest}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

/**
 * A wait, made visible.
 *
 * The voice round trip — model thinks, tool call, server write, model speaks —
 * runs to several seconds. Unannounced, that reads as a hang, and a seller who
 * thinks the app has died closes the tab. The label carries the meaning; the
 * dots are decoration and are switched off for anyone who asked for less
 * motion (globals.css).
 */
export function Pending({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 text-sm font-medium text-ink-muted"
    >
      <span aria-hidden="true" className="flex items-center gap-1">
        <span className="pending-dot size-2 rounded-full bg-brand" />
        <span className="pending-dot size-2 rounded-full bg-brand" />
        <span className="pending-dot size-2 rounded-full bg-brand" />
      </span>
      {label}
    </div>
  );
}

export function Card({
  children,
  tone = "plain",
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  /** "attention" is reserved for contradictions. Nothing else earns warm. */
  tone?: "plain" | "attention" | "sunken";
  className?: string;
  as?: "div" | "section" | "li" | "article";
}) {
  const tones = {
    plain: "bg-surface border-line",
    attention: "bg-attention-surface border-attention-line",
    sunken: "bg-surface-sunken border-line",
  } as const;
  return (
    <Tag className={`rounded-card border p-4 ${tones[tone]} ${className}`}>
      {children}
    </Tag>
  );
}

/** Status word plus a shape, so meaning never rests on colour alone. */
export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "positive" | "attention" | "brand";
}) {
  const tones = {
    neutral: "bg-surface-sunken text-ink-muted",
    positive: "bg-positive-surface text-positive",
    attention: "bg-attention-surface text-attention",
    brand: "bg-brand-tint text-brand-strong",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div>
      {/* Visible label, never a placeholder standing in for one. */}
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
        {required && (
          <span className="text-danger" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      {hint && (
        <p id={`${htmlFor}-hint`} className="mt-1 text-sm text-ink-faint">
          {hint}
        </p>
      )}
      <div className="mt-1.5">{children}</div>
      {/* Errors sit next to the field, not in a summary far away. */}
      {error && (
        <p
          id={`${htmlFor}-error`}
          role="alert"
          className="mt-1.5 text-sm font-medium text-danger"
        >
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  "min-h-12 w-full rounded-control border-2 border-line-strong bg-surface px-3 text-base text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none";
