import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Athena",
  description: "A personal AI learning platform.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body>
        <div className="min-h-screen flex flex-col">
          <header className="border-b border-[var(--color-border)] px-6 py-3 flex items-center gap-6">
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
            </nav>
          </header>
          <main className="flex-1 px-6 py-8 max-w-4xl w-full mx-auto">{children}</main>
        </div>
      </body>
    </html>
  );
}
