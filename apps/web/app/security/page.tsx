import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing-shell";
import { SECURITY_COMMITMENTS, SECURITY_ROADMAP } from "@/lib/site";

export const metadata: Metadata = {
  title: "Security",
  description:
    "How DESK handles your purchase orders, item master and ERP credentials: tenant isolation, encryption, least-privilege ERP scopes, no training on customer data, an immutable audit log, and the SOC 2 roadmap.",
};

export default function SecurityPage() {
  return (
    <MarketingShell>
      <section className="container-page pt-16 pb-10 sm:pt-20">
        <p className="eyebrow">Security</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
          Your orders, your item master, your ERP credentials
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-muted">
          DESK sits between your customers&apos; inboxes and your system of record. These are the
          commitments we build to. They are commitments and a roadmap, not certifications we hold
          today; we say so plainly because your controller will ask.
        </p>
      </section>

      <section className="container-page pb-16">
        <h2 className="sr-only">Commitments</h2>
        <ul className="grid gap-6 md:grid-cols-2">
          {SECURITY_COMMITMENTS.map((item) => (
            <li key={item.title} className="card">
              <h3 className="font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm text-muted">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-y border-border bg-bg-subtle">
        <div className="container-page py-16">
          <h2 className="text-2xl font-semibold tracking-tight">Compliance roadmap</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            We are pre-launch. Nothing below is held yet; each item has a target and we will update
            this page when it is done.
          </p>
          <ul className="mt-6 space-y-3">
            {SECURITY_ROADMAP.map((item) => (
              <li key={item} className="card text-sm">
                <span className="mr-2 rounded bg-bg-subtle px-1.5 py-0.5 text-xs font-medium text-muted">
                  Planned
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="container-page py-16">
        <h2 className="text-2xl font-semibold tracking-tight">Reporting a vulnerability</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          If you find a security issue, email security@ at this domain with the details. We
          acknowledge within two business days and will not pursue good-faith research.
        </p>
      </section>
    </MarketingShell>
  );
}
