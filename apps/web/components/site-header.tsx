import Link from "next/link";
import { isClerkConfigured } from "@/lib/env";
import { SITE } from "@/lib/site";

const NAV = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/security", label: "Security" },
] as const;

export function SiteHeader() {
  const clerk = isClerkConfigured();
  return (
    <header className="border-b border-border bg-bg/80 backdrop-blur supports-[backdrop-filter]:bg-bg/70 sticky top-0 z-20">
      <div className="container-page flex h-14 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span
            aria-hidden="true"
            className="inline-block size-5 rounded-sm bg-accent"
            style={{ clipPath: "polygon(0 0, 100% 0, 100% 70%, 70% 100%, 0 100%)" }}
          />
          {SITE.name}
          <span className="sr-only">home</span>
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-6 text-sm text-muted sm:flex">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="hover:text-fg">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {clerk ? (
            <>
              <Link href="/sign-in" className="btn-secondary !py-1.5">
                Sign in
              </Link>
              <Link href="/sign-up" className="btn-primary !py-1.5">
                Start free
              </Link>
            </>
          ) : (
            <Link href="/#audit" className="btn-primary !py-1.5">
              {SITE.auditCta}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
