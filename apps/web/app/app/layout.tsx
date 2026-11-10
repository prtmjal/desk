import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { AppNav } from "@/components/app-nav";
import { ClerkNotConfigured } from "@/components/clerk-not-configured";
import { isClerkConfigured } from "@/lib/env";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: { default: "Inbox", template: `%s — ${SITE.name} app` },
  robots: { index: false, follow: false },
};

/**
 * Authenticated application shell. Access control lives in proxy.ts
 * (clerkMiddleware protects /app(.*)); this layout only renders chrome.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  if (!isClerkConfigured()) return <ClerkNotConfigured feature="The application" />;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex w-full flex-col border-b border-border bg-bg-subtle md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <Link href="/app" className="flex items-center gap-2 font-semibold tracking-tight">
            <span
              aria-hidden="true"
              className="inline-block size-4 rounded-sm bg-accent"
              style={{ clipPath: "polygon(0 0, 100% 0, 100% 70%, 70% 100%, 0 100%)" }}
            />
            {SITE.name}
          </Link>
          <div className="md:hidden">
            <UserButton />
          </div>
        </div>
        <div className="border-b border-border px-3 py-3">
          <OrganizationSwitcher
            hidePersonal
            afterCreateOrganizationUrl="/app"
            afterSelectOrganizationUrl="/app"
            afterLeaveOrganizationUrl="/app"
          />
        </div>
        <div className="px-3 py-3">
          <AppNav />
        </div>
        <div className="mt-auto hidden items-center justify-between border-t border-border px-4 py-3 md:flex">
          <span className="text-xs text-muted">Phase 0 preview</span>
          <UserButton />
        </div>
      </aside>
      <main id="main" className="flex-1">
        {children}
      </main>
    </div>
  );
}
