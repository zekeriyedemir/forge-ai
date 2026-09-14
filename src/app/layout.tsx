import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Forge AI — Build from ambition",
  description: "An AI command center for turning a business goal into an actionable plan.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
