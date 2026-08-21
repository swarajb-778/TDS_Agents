import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";

/*
 * Self-hosted at build time: no third-party request, preloaded, and
 * font-display: swap so text is never invisible while it loads.
 *
 * Figtree has a tall x-height, which is what actually makes small text legible
 * on a phone — more than font size alone.
 */
const figtree = Figtree({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-figtree",
});

export const metadata: Metadata = {
  title: "Seller disclosures — Loqol",
  description: "Complete your California Transfer Disclosure Statement.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Never disable zoom. viewportFit covers the notch and home indicator.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={figtree.variable}>
      <body className="min-h-dvh bg-canvas font-sans text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-brand focus:px-4 focus:py-2 focus:text-on-brand"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
