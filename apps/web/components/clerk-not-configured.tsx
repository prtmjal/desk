import Link from "next/link";
import { CLERK_ENV_VARS } from "@/lib/env";

export function ClerkNotConfigured({ feature }: { feature: string }) {
  return (
    <main className="container-page flex flex-1 items-center py-16">
      <div className="card max-w-xl">
        <p className="eyebrow">Not configured</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{feature} needs Clerk</h1>
        <p className="mt-2 text-sm text-muted">
          The marketing site runs without any keys, but sign-in and the application shell are
          powered by Clerk. Set these variables (see <code>.env.example</code> at the repo root) and
          restart the dev server:
        </p>
        <ul className="mt-4 space-y-1 font-mono text-sm">
          {CLERK_ENV_VARS.map((v) => (
            <li key={v}>
              <code className="rounded bg-bg-subtle px-1.5 py-0.5">{v}</code>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted">
          <code>CLERK_WEBHOOK_SECRET</code> is only needed for the <code>/api/webhooks/clerk</code>{" "}
          route. Add <code>STRIPE_SECRET_KEY</code> to create a Stripe customer when an organization
          is created.
        </p>
        <p className="mt-4 text-xs text-muted">
          To explore the product without any accounts, start the dev server in demo mode:{" "}
          <code className="rounded bg-bg-subtle px-1.5 py-0.5">DESK_DEMO=1 pnpm --filter @desk/web dev</code>. It uses a sample
          distributor, an in-process database and an offline parser.
        </p>
        <Link href="/" className="btn-secondary mt-6">
          Back to the site
        </Link>
      </div>
    </main>
  );
}
