import Link from "next/link";
import { MarketingShell } from "@/components/marketing-shell";

export default function NotFound() {
  return (
    <MarketingShell>
      <section className="container-page py-24">
        <p className="eyebrow">404</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">That page is not here</h1>
        <p className="mt-2 text-muted">Like a PO with the wrong ship-to, it probably went somewhere else.</p>
        <Link href="/" className="btn-secondary mt-6">
          Back to the home page
        </Link>
      </section>
    </MarketingShell>
  );
}
