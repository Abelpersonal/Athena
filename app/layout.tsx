import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { ServiceWorkerRegister } from "../components/ServiceWorkerRegister.js";

export const metadata: Metadata = {
  title: "Athena",
  description: "A personal AI learning platform.",
};

/** `themeColor` here (not just the manifest's) is what a real installed/backgrounded PWA uses for its status bar — matches the design system's `--color-bg`. */
export const viewport: Viewport = {
  themeColor: "#0b0e12",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body>
        <ServiceWorkerRegister />
        <div className="min-h-screen flex flex-col">
          <header className="border-b border-[var(--color-border)] px-4 sm:px-6 py-3 flex items-center gap-4 sm:gap-6 flex-wrap">
            <Link href="/" className="font-semibold tracking-tight text-[var(--color-text)]">
              Athena
            </Link>
            <nav className="flex gap-4 text-sm text-[var(--color-text-muted)]">
              <Link href="/" className="hover:text-[var(--color-text)]">
                Dashboard
              </Link>
              <Link href="/new" className="hover:text-[var(--color-text)]">
                Start something new
              </Link>
              <Link href="/downloads" className="hover:text-[var(--color-text)]">
                Downloads
              </Link>
            </nav>
          </header>
          <main className="flex-1 px-4 sm:px-6 py-8 max-w-4xl w-full mx-auto">{children}</main>
        </div>
      </body>
    </html>
  );
}
