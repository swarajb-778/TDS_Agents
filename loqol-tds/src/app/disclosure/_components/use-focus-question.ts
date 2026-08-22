"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * "You were here" — the seller-facing half of the `?q=` handoff.
 *
 * A seller who has just been talking about the fire alarm and asks for the
 * buttons should land on the fire alarm, not at the top of a fifty-question
 * chapter. This brings the named question into view and marks it, and does
 * nothing else: it never decides what gets asked, and it holds no position of
 * its own that could disagree with the answers.
 *
 * Failure is silent by design. If the id names nothing on screen — stale link,
 * a gate that has since closed, a question in another chapter — there is
 * nothing to point at and the seller simply starts at the top, which is where
 * they started before any of this existed.
 */
export function useFocusQuestion(requested?: string | null) {
  const [spotlight, setSpotlight] = useState<string | null>(requested ?? null);
  const node = useRef<HTMLElement | null>(null);

  /** Attach to whichever element is currently spotlit; any element type. */
  const target = useCallback((el: HTMLElement | null) => {
    node.current = el;
  }, []);

  useEffect(() => {
    const el = spotlight ? node.current : null;
    if (!el) return;

    // Moving focus is what carries this to a screen reader — scrolling alone
    // moves the viewport and leaves the reading cursor at the top of the page.
    el.focus({ preventScroll: true });

    // A seller who asked their phone for less motion gets a jump, not a glide.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const bring = () =>
      el.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });

    bring();

    /*
     * And again, two frames later.
     *
     * Arriving here is a navigation, and a navigation puts the page back at the
     * top — the browser does it on a fresh load, the router does it on a
     * client-side push. Whichever of us goes second wins, and that ordering is
     * not ours to rely on. The second call is idempotent: if the first one held,
     * the question is already centred and this does nothing.
     *
     * Not the only call, though. requestAnimationFrame does not run in a
     * backgrounded tab, and the seller who left this open and came back later is
     * precisely the person this feature is for.
     */
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(bring);
    });

    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [spotlight]);

  /**
   * Once they have answered it, it stops being the thing to look at. The mark
   * is a pointer to unfinished business, not a permanent decoration.
   */
  const clear = useCallback((questionId: string) => {
    setSpotlight((current) => (current === questionId ? null : current));
  }, []);

  return { spotlight, target, clear };
}
