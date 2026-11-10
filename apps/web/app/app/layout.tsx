import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { AppNav } from "@/components/app-nav";
import { ClerkNotConfigured } from "@/components/clerk-not-configured";
import { isClerkConfigured, isDatabaseConfigured, isDemoMode } from "@/lib/env";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: { default: "Inbox", template: `%s — ${SITE.name} app` },
  robots: { index: false, follow: false },
};

// Every page under /app is per-tenant and reads live data.
export const dynamic = "force-dynamic";
// Uploads are read by the model before the action returns when no job runner is configured.
export const maxDuration = 300;

/**
 * Authenticated application shell. Access control lives in proxy.ts
 * (clerkMiddleware protects /app(.*)); tenant resolution lives in
 * lib/server/session.ts. This layout only renders chrome.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const demo = isDemoMode();
  if (!demo && !isClerkConfigured()) return <ClerkNotConfigured feature="The application" />;
  if (!demo && !isDatabaseConfigured()) {
    return (
      <main className="container-page flex flex-1 items-center py-16">
        <div className="card max-w-xl">
          <p className="eyebrow">Not configured</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">The application needs a database</h1>
          <p className="mt-2 text-sm text-muted">
            Set <code className="rounded bg-bg-subtle px-1.5 py-0.5">DATABASE_URL</code> to a Postgres database (Neon or Supabase), run{" "}
            <code className="rounded bg-bg-subtle px-1.5 py-0.5">pnpm db:migrate</code>, and restart. See <code>docs/runbooks/SETUP.md</code>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex w-full flex-col border-b border-border bg-bg-subtle md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <Link href="/app" className="flex items-center gap-2 font-semibold tracking-tight">
            <span aria-hidden="true" className="inline-block size-4 rounded-sm bg-accent" style={{ clipPath: "polygon(0 0, 100% 0, 100% 70%, 70% 100%, 0 100%)" }} />
            {SITE.name}
          </Link>
          {demo ? null : (
            <div className="md:hidden">
              <UserButton />
            </div>
          )}
        </div>
        <div className="border-b border-border px-3 py-3">
          {demo ? (
            <p className="px-1 text-sm">
              <span className="badge badge-warn">Demo mode</span>
              <span className="mt-1 block text-xs text-muted">Sample distributor, offline parser, no real ERP or email.</span>
            </p>
          ) : (
            <OrganizationSwitcher hidePersonal afterCreateOrganizationUrl="/app" afterSelectOrganizationUrl="/app" afterLeaveOrganizationUrl="/app" />
          )}
        </div>
        <div className="px-3 py-3">
          <AppNav />
        </div>
        {demo ? null : (
          <div className="mt-auto hidden items-center justify-end border-t border-border px-4 py-3 md:flex">
            <UserButton />
          </div>
        )}
      </aside>
      <main id="main" className="min-w-0 flex-1">
        {children}
      </main>
    </div>
  );
}
