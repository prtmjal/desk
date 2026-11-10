import Link from "next/link";
import { MarketingShell } from "@/components/marketing-shell";
import { WaitlistForm } from "@/components/waitlist-form";
import { ERPS, SITE } from "@/lib/site";

const STEPS = [
  {
    n: "1",
    title: "Orders arrive",
    body: "Customers keep sending POs the way they do today: an email with a PDF, a spreadsheet, a photo of a handwritten sheet, a fax-to-email. You forward them to your DESK address, or your inbox rule does.",
  },
  {
    n: "2",
    title: "DESK drafts the sales order",
    body: "Within a minute DESK identifies the customer, reads every line, matches each part number to your item master (including the customer's own aliases, pack sizes and UoM quirks) and checks price, stock, terms and duplicate PO numbers against your ERP.",
  },
  {
    n: "3",
    title: "You confirm the exceptions",
    body: "Clean orders post straight into your ERP as a sales order with the document attached. Anything uncertain lands in a review queue: source on the left, draft on the right, fix with the keyboard, confirm. Every correction teaches the next one.",
  },
] as const;

const PAIN = [
  {
    stat: "1 to 3 FTEs",
    label: "rekeying purchase orders",
    body: "At 100 orders a day a distributor runs 1.5 to 3 full-time people, at $45k to $65k each fully loaded, copying numbers from one screen into another.",
  },
  {
    stat: "~4%",
    label: "manual entry error rate",
    body: "Wrong item, wrong quantity, wrong ship-to. Each one becomes a return, a credit memo, a re-ship and a customer who calls your owner.",
  },
  {
    stat: "5 to 15 min",
    label: "per order, by hand",
    body: "A CSR gets through 40 to 80 orders in a day. The rest of the day is spent on the orders that did not fit the template.",
  },
] as const;

const EXCEPTIONS = [
  { title: "Unknown part number", body: "Top three matches with the evidence (description, pack size, past orders from this customer). Pick one and it is remembered as an alias." },
  { title: "Price does not match", body: "List price next to PO price with the difference. Honor the PO, use list, or hold for a call, per your policy." },
  { title: "Short on stock", body: "Backorder, partial ship or hold, by customer, the way you already do it." },
  { title: "Duplicate PO number", body: "Linked to the original so nothing posts twice." },
] as const;

export default function HomePage() {
  return (
    <MarketingShell>
      {/* Hero */}
      <section className="container-page pt-16 pb-12 sm:pt-24 sm:pb-16">
        <div className="max-w-3xl">
          <p className="eyebrow">{SITE.category} for wholesale distributors</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            {SITE.tagline}
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted">
            DESK reads the purchase orders your customers email you, matches them to your items and
            customers, validates them against your ERP and posts the sales order. Your team only sees
            the ones that need a human.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link href="#audit" className="btn-primary">
              {SITE.auditCta}
            </Link>
            <Link href="#how-it-works" className="btn-secondary">
              See how it works
            </Link>
          </div>
          <p className="mt-4 text-sm text-muted">
            Send us 50 recent POs. We send back field-level accuracy and how many would have posted
            without a touch. No ERP connection needed.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-y border-border bg-bg-subtle">
        <div className="container-page py-16">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">How it works</h2>
          <p className="mt-2 max-w-2xl text-muted">
            Three steps, and only the third one needs anybody at your company.
          </p>
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.n} className="card flex flex-col">
                <span
                  aria-hidden="true"
                  className="inline-flex size-8 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent-strong"
                >
                  {step.n}
                </span>
                <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Pain */}
      <section className="container-page py-16">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">What order entry costs today</h2>
        <p className="mt-2 max-w-2xl text-muted">
          Nobody budgets for it, because it is spread across people whose job title says something
          else. Add it up.
        </p>
        <dl className="mt-10 grid gap-6 md:grid-cols-3">
          {PAIN.map((item) => (
            <div key={item.label} className="card">
              <dt className="text-sm font-medium text-muted">{item.label}</dt>
              <dd className="mt-1 text-3xl font-semibold tracking-tight">{item.stat}</dd>
              <dd className="mt-3 text-sm text-muted">{item.body}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-sm text-muted">
          Industry benchmarks put labor-efficiency gains from automating order processing at $75k to
          $180k a year for a $50M distributor. DESK is priced against that line, not an IT budget.{" "}
          <Link href="/pricing" className="underline underline-offset-2 hover:text-fg">
            See the price card.
          </Link>
        </p>
      </section>

      {/* Exceptions */}
      <section className="border-y border-border bg-bg-subtle">
        <div className="container-page py-16">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Built for the orders that do not fit
          </h2>
          <p className="mt-2 max-w-2xl text-muted">
            The easy POs were never the problem. DESK is designed around the exceptions your desk
            deals with every day.
          </p>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2">
            {EXCEPTIONS.map((item) => (
              <li key={item.title} className="card">
                <h3 className="font-semibold">{item.title}</h3>
                <p className="mt-1 text-sm text-muted">{item.body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-muted">
            Auto-posting is off by default. You switch it on per customer when the accuracy numbers
            earn it, for example: every line at or above 0.98 confidence and price within 2% of list.
          </p>
        </div>
      </section>

      {/* Works with */}
      <section className="container-page py-16">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Works with your ERP</h2>
        <p className="mt-2 max-w-2xl text-muted">
          Sales orders are posted through the ERP&apos;s own API, as draft or unapproved where the ERP
          supports it, with the source document attached. A CSV / Excel export is always available so
          you can pilot before your connector is live.
        </p>
        <ul className="mt-8 flex flex-wrap gap-2" aria-label="Supported ERP systems">
          {ERPS.map((erp) => (
            <li
              key={erp}
              className="rounded-full border border-border bg-card px-3 py-1 text-sm text-fg"
            >
              {erp}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted">
          Connector order follows design-partner demand; QuickBooks Online and NetSuite ship first.
        </p>
      </section>

      {/* Audit form */}
      <section id="audit" className="border-t border-border bg-bg-subtle scroll-mt-16">
        <div className="container-page grid gap-10 py-16 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <p className="eyebrow">Free PO audit</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              {SITE.auditCta}
            </h2>
            <p className="mt-3 text-muted">
              The fastest way to know whether this works on your documents is to run it on your
              documents. You get a report with:
            </p>
            <ul className="mt-4 space-y-2 text-sm text-muted">
              <li>Field-level accuracy on header and lines, against your own item and customer lists</li>
              <li>How many of the 50 would have posted touchless under a conservative policy</li>
              <li>The exceptions we would have raised, and why</li>
              <li>An estimate of hours per week your desk gets back</li>
            </ul>
            <p className="mt-4 text-sm text-muted">
              Documents are deleted after the report unless you ask us to keep them for a pilot.
            </p>
          </div>
          <WaitlistForm />
        </div>
      </section>
    </MarketingShell>
  );
}
