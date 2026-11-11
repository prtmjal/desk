import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { legal, SITE } from "@/lib/site";

export const metadata: Metadata = { title: "Terms of Service", description: `The agreement between you and the company behind ${SITE.name}.` };
export const dynamic = "force-dynamic";

export default function TermsPage() {
  const l = legal();
  const n = SITE.name;
  return (
    <LegalPage
      title="Terms of Service"
      intro={
        <p>
          These terms are the agreement between {l.entity} (&quot;we&quot;) and the business that creates a {n} workspace (&quot;you&quot;). By creating a workspace
          or using {n} you accept them. If you are accepting for a company, you confirm you are allowed to.
        </p>
      }
      sections={[
        {
          heading: "The service",
          body: (
            <>
              <p>
                {n} reads purchase orders your customers send you, matches them to your items and customers, checks them against data from your ERP, and
                creates draft or posted sales orders in the ERP you connect. You decide what posts automatically and what waits for a person.
              </p>
              <p>
                {n} uses AI models to read documents. Reading can be wrong. The product is built to flag what it is unsure of, but you remain responsible
                for the orders in your ERP, including those posted automatically under rules you set.
              </p>
            </>
          ),
        },
        {
          heading: "Your account",
          body: (
            <p>
              Keep your sign-in details safe, give access only to people who work for you, and tell us promptly at {l.email} if you suspect unauthorized
              access. You are responsible for what happens in your workspace.
            </p>
          ),
        },
        {
          heading: "Your data",
          body: (
            <>
              <p>
                Your documents, item and customer lists, orders and ERP data stay yours. You give us permission to process them only to provide and
                support the service. We do not sell them and we do not use them to train AI models. How we handle personal data is in the{" "}
                <Link href="/privacy" className="underline underline-offset-2">Privacy Policy</Link>.
              </p>
              <p>You confirm you have the right to send us the documents and connect the systems you connect.</p>
            </>
          ),
        },
        {
          heading: "Connected systems",
          body: (
            <p>
              When you connect an ERP or email, you authorize us to read and write the data needed for the service using the access you grant. Those
              systems are provided by others under their own terms; we are not responsible for their availability or changes.
            </p>
          ),
        },
        {
          heading: "Fees",
          body: (
            <>
              <p>
                Prices are on the <Link href="/pricing" className="underline underline-offset-2">pricing page</Link>: a monthly platform fee that includes a
                number of posted orders, and a per-order fee above that. Only orders that reach your ERP count. Rejected or unreadable documents are not charged.
              </p>
              <p>
                Fees are billed monthly through our payment provider, are exclusive of taxes, and are not refundable except where the law requires. If a
                payment fails we may pause posting to your ERP until it is resolved; incoming orders are still received and held.
              </p>
              <p>We may change prices with at least 30 days&apos; notice, effective from your next billing period.</p>
            </>
          ),
        },
        {
          heading: "Acceptable use",
          body: (
            <p>
              Do not use {n} to break the law, to process documents you have no right to process, to probe or disrupt the service, to resell it without our
              agreement, or to build a competing product from it.
            </p>
          ),
        },
        {
          heading: "Availability and changes",
          body: <p>We work to keep {n} available and will give reasonable notice of planned changes that reduce functionality. We may suspend a workspace that puts the service or other customers at risk.</p>,
        },
        {
          heading: "Ending the agreement",
          body: (
            <p>
              You can cancel at any time from Settings; the plan runs to the end of the paid period. We may end the agreement with 30 days&apos; notice, or
              immediately for serious breach or non-payment. After it ends you can ask for an export of your orders, and we delete your workspace data within
              30 days of your written request, except what the law requires us to keep.
            </p>
          ),
        },
        {
          heading: "Warranty and liability",
          body: (
            <>
              <p>
                The service is provided as is. To the extent the law allows, we exclude implied warranties, and we are not liable for indirect or consequential
                loss, lost profit, or loss arising from orders posted under rules you configured.
              </p>
              <p>Our total liability for any claim is limited to the fees you paid us in the 12 months before the event giving rise to it. Nothing here limits liability that cannot be limited by law.</p>
            </>
          ),
        },
        {
          heading: "General",
          body: (
            <p>
              These terms are governed by the laws of {l.jurisdiction}, whose courts have jurisdiction. We may update these terms; if a change is material we
              will tell you by email or in the product at least 30 days before it applies. If part of these terms cannot be enforced, the rest still applies.
            </p>
          ),
        },
      ]}
    />
  );
}
