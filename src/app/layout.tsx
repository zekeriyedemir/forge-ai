import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Forge AI — Your next great commit", template: "%s | Forge AI" },
  description: "An AI-powered development workspace for GitHub repositories. Turn a goal into a plan, review proposed changes, and keep every next step in view.",
  applicationName: "Forge AI",
  icons: { icon: "/icon.svg" },
  openGraph: { title: "Forge AI — Your next great commit", description: "From idea to plan to pull request. A development workspace with AI workflows and human approval." },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" data-scroll-behavior="smooth" className="h-full antialiased"><body className="min-h-full">{children}</body></html>;
}
