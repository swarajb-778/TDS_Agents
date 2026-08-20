import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Seller disclosures — Loqol",
  description: "Complete your California Transfer Disclosure Statement.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      {/* viewport-fit + a light background: this is a phone-first document */}
      <body className="min-h-dvh bg-stone-50 text-stone-900 antialiased">
        {children}
      </body>
    </html>
  );
}
