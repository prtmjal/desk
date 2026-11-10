import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing-shell";
import { FAQ, MODULES, ONBOARDING, PLANS, SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "DESK pricing: a flat platform fee plus a per-order charge only for orders that reach your ERP. Starter $299/mo, Growth $799/mo, Scale $1,999/mo. Published, no quote needed.",
};

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

function faqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

function offersJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE.name,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: SITE.description,
    offers: PLANS.map((plan) => ({
      "@type": "Offer",
      name: plan.name,
      price: plan.monthly,
      priceCurrency: "USD",
      description: `${plan.includedOrders} orders/month included, then ${usdCents.format(plan.overage)} per posted order.`,
    })),
  };
}

export default function PricingPage() {
  return (
    <MarketingShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd()) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(offersJsonLd()) }}
      />

      <section className="container-page pt-16 pb-10 sm:pt-20">
        <p className="eyebrow">Pricing</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
          Priced against the labor line, not the software budget
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-muted">
          A flat platform fee for predictability, plus a per-order charge only for orders that
          actually reach your ERP. Rejected, duplicate or failed documents are never billed. Prices
          are published; there is no quote to request.
        </p>
      </section>

      <section className="container-page pb-16">
        <ul className="grid gap-6 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <li
              key={plan.id}
              className={`card flex flex-col ${plan.highlight ? "border-accent ring-1 ring-accent" : ""}`}
            >
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-semibold">{plan.name}</h2>
                {plan.highlight ? (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-strong">
                    Most desks
                  </span>
                ) : null}
              </div>
              <p className="mt-4">
                <span className="text-4xl font-semibold tracking-tight">{usd.format(plan.monthly)}</span>
                <span className="text-sm text-muted">/month</span>
              </p>
              <p className="mt-2 text-sm">
                <strong className="font-medium">{plan.includedOrders.toLocaleString("en-US")}</strong>{" "}
                posted orders included, then{" "}
                <strong className="font-medium">{usdCents.format(plan.overage)}</strong> per order
              </p>
              <p className="mt-3 rounded-md bg-bg-subtle px-3 py-2 text-xs text-muted">
                <span className="font-medium text-fg">FTE-equivalent: </span>
                {plan.fteLine}
              </p>
              <p className="mt-4 text-sm text-muted">{plan.fits}</p>
              <ul className="mt-4 space-y-2 text-sm">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span aria-hidden="true" className="mt-1 inline-block size-1.5 shrink-0 rounded-full bg-accent" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-6">
                <Link
                  href="/#audit"
                  className={plan.highlight ? "btn-primary w-full" : "btn-secondary w-full"}
                >
                  Start with the free audit
                </Link>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted">
          Annual prepay discounted 15 to 20%. Design partners lock their price for 24 months. The
          FTE line assumes a part-time order-entry clerk at $2,000 to $3,000 a month fully loaded.
        </p>
      </section>

      <section className="border-y border-border bg-bg-subtle">
        <div className="container-page grid gap-10 py-16 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Modules</h2>
            <p className="mt-2 text-sm text-muted">
              Add along the same desk as they ship. Flat monthly or per outcome, your choice.
            </p>
            <dl className="mt-6 divide-y divide-border rounded-lg border border-border bg-card">
              {MODULES.map((m) => (
                <div key={m.name} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:justify-between">
                  <dt className="font-medium">{m.name}</dt>
                  <dd className="text-sm text-muted">{m.price}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Onboarding</h2>
            <p className="mt-2 text-sm text-muted">
              Target: first draft order within 60 minutes of connecting.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              <li className="card">
                <p className="font-medium">Self-serve</p>
                <p className="mt-1 text-muted">{ONBOARDING.selfServe}</p>
              </li>
              <li className="card">
                <p className="font-medium">Guided</p>
                <p className="mt-1 text-muted">{ONBOARDING.guided}</p>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="container-page py-16">
        <h2 className="text-2xl font-semibold tracking-tight">Questions distributors ask us</h2>
        <dl className="mt-8 grid gap-6 md:grid-cols-2">
          {FAQ.map((item) => (
            <div key={item.q} className="card">
              <dt className="font-semibold">{item.q}</dt>
              <dd className="mt-2 text-sm text-muted">{item.a}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-8 text-sm text-muted">
          Something not covered? The audit request form on the{" "}
          <Link href="/#audit" className="underline underline-offset-2 hover:text-fg">
            home page
          </Link>{" "}
          reaches a person.
        </p>
      </section>
    </MarketingShell>
  );
}
