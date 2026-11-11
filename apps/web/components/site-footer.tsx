import Link from "next/link";
import { SITE } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border">
      <div className="container-page flex flex-col gap-6 py-10 text-sm text-muted sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-sm">
          <p className="font-semibold text-fg">{SITE.name}</p>
          <p className="mt-1">{SITE.category} for wholesale distributors and light manufacturers.</p>
          <p className="mt-3 text-xs">
            Built for desks that key emailed and PDF purchase orders into QuickBooks, NetSuite,
            Acumatica, Odoo, Fishbowl and friends.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-10 gap-y-2 sm:grid-cols-3">
          <Link href="/#how-it-works" className="hover:text-fg">
            How it works
          </Link>
          <Link href="/pricing" className="hover:text-fg">
            Pricing
          </Link>
          <Link href="/security" className="hover:text-fg">
            Security
          </Link>
          <Link href="/#audit" className="hover:text-fg">
            Free PO audit
          </Link>
          <Link href="/terms" className="hover:text-fg">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-fg">
            Privacy
          </Link>
          <Link href="/llms.txt" className="hover:text-fg">
            llms.txt
          </Link>
          <Link href="/sign-in" className="hover:text-fg">
            Sign in
          </Link>
        </nav>
      </div>
      <div className="container-page pb-8 text-xs text-muted">
        <p>&copy; {new Date().getFullYear()} {SITE.name}. Pre-launch. Prices shown are the launch price card and may change before general availability.</p>
      </div>
    </footer>
  );
}
