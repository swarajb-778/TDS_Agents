/**
 * WCAG contrast assertions for the design tokens, in BOTH themes.
 *
 * Contrast is the first accessibility rule and the easiest to get wrong by
 * eye — a dark-mode palette that looks fine can sit at 2:1. This parses the
 * real token values out of globals.css so it cannot drift from what ships.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

/**
 * Light lives in @theme; dark overrides it in a plain :root rule inside the
 * media query. That split is load-bearing — a nested @theme is hoisted by
 * Tailwind and silently wins in both themes, which shipped a permanently dark
 * app once already.
 */
function tokens(theme: "light" | "dark"): Record<string, string> {
  const light = [...css.matchAll(/@theme\s*\{([\s\S]*?)\n\s*\}/g)].map((m) => m[1]);
  const dark = [
    ...css.matchAll(/prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([\s\S]*?)\n\s{2}\}/g),
  ].map((m) => m[1]);
  const merged: Record<string, string> = {};
  const chosen = theme === "light" ? light : [...light, ...dark];
  for (const block of chosen) {
    for (const [, name, value] of block.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) {
      merged[name] = value;
    }
  }
  return merged;
}

const channel = (v: number) =>
  v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** [foreground, background, minimum, what it is] */
const PAIRS: Array<[string, string, number, string]> = [
  ["ink", "canvas", 7, "body text on the page"],
  ["ink", "surface", 7, "body text on a card"],
  ["ink-muted", "canvas", 4.5, "secondary text on the page"],
  ["ink-muted", "surface", 4.5, "secondary text on a card"],
  ["ink-faint", "surface", 4.5, "hint text on a card"],
  ["ink-faint", "canvas", 4.5, "hint text on the page"],
  ["on-brand", "brand", 4.5, "label on a primary button"],
  ["brand-strong", "surface", 4.5, "link on a card"],
  ["brand-strong", "canvas", 4.5, "link on the page"],
  ["attention", "attention-surface", 4.5, "conflict text on its card"],
  ["danger", "surface", 4.5, "error text on a card"],
  ["danger", "danger-surface", 4.5, "error text on its card"],
  ["positive", "positive-surface", 4.5, "success text on its card"],
  // Non-text UI only needs 3:1.
  ["line-strong", "surface", 3, "input border"],
  ["brand", "canvas", 3, "focus ring on the page"],
  ["brand", "surface", 3, "focus ring on a card"],
];

let failures = 0;
for (const theme of ["light", "dark"] as const) {
  const t = tokens(theme);
  console.log(`\n${theme}`);
  for (const [fg, bg, min, what] of PAIRS) {
    assert.ok(t[fg], `missing token --color-${fg}`);
    assert.ok(t[bg], `missing token --color-${bg}`);
    const r = ratio(t[fg], t[bg]);
    const ok = r >= min;
    if (!ok) failures++;
    console.log(
      `  ${ok ? "✓" : "✗"} ${r.toFixed(2)}:1 (need ${min}) — ${what}`,
    );
  }
}

assert.equal(failures, 0, `${failures} token pair(s) below their WCAG minimum`);
console.log("\ncontrast checks passed\n");
