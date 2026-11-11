import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { legal, SITE } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy Policy", description: `What ${SITE.name} collects, why, who processes it, and your choices.` };
export const dynamic = "force-dynamic";

const SUBPROCESSORS: Array<[string, string]> = [
  ["Anthropic", "Reads documents with AI models. Content sent through its API is not used to train its models."],
  ["Clerk", "Sign-in and organization membership."],
  ["Database host (Neon or Supabase)", "Stores workspace data."],
  ["Object storage (Cloudflare R2 or Amazon S3)", "Stores the original documents."],
  ["Postmark", "Receives order emails forwarded to your workspace address and sends acknowledgments and digests."],
  ["Inngest", "Schedules and retries background processing."],
  ["Stripe", "Subscriptions and payments. We never see full card numbers."],
  ["Vercel", "Hosts the application."],
];

export default function PrivacyPage() {
  const l = legal();
  const n = SITE.name;
  return (
    <LegalPage
      title="Privacy Policy"
      intro={
        <p>
          {l.entity} runs {n}. This policy explains what personal data we handle and why. For the documents and business data you put into {n}, you are the
          controller and we process it on your instructions; for account and billing data, we are the controller.
        </p>
      }
      sections={[
        {
          heading: "What we collect",
          body: (
            <ul className="list-disc pl-5">
              <li><strong>Account data:</strong> name, work email, company, and sign-in records of the people you invite.</li>
              <li><strong>Workspace data:</strong> the purchase orders and emails sent to your workspace, your item and customer lists, prices, stock levels, and the orders created. These can contain names, emails, phone numbers and addresses of your customers&apos; staff.</li>
              <li><strong>Connection data:</strong> access tokens for the ERP you connect, stored encrypted.</li>
              <li><strong>Billing data:</strong> plan, usage counts and invoices. Card details are held by our payment provider.</li>
              <li><strong>Usage and logs:</strong> actions taken in the product (also shown to you as the audit log), and technical logs such as IP address and browser.</li>
              <li><strong>Website enquiries:</strong> what you enter in our forms.</li>
            </ul>
          ),
        },
        {
          heading: "How we use it",
          body: (
            <p>
              To provide the service (reading, matching, validating and posting orders), to keep it secure, to bill you, to support you, and to improve
              accuracy for your own workspace (for example remembering how a customer writes your part numbers). We do not sell personal data, show ads,
              or use your documents to train AI models.
            </p>
          ),
        },
        {
          heading: "Who processes it for us",
          body: (
            <>
              <p>We use these providers, each under a contract that limits them to our instructions:</p>
              <ul className="list-disc pl-5">
                {SUBPROCESSORS.map(([name, what]) => (
                  <li key={name}><strong>{name}:</strong> {what}</li>
                ))}
              </ul>
              <p>When you connect an ERP such as QuickBooks Online, we exchange data with it at your direction. We disclose data to authorities only when the law requires it.</p>
            </>
          ),
        },
        {
          heading: "Where it is processed",
          body: <p>Our providers process data in the United States and other countries. Where personal data leaves your region we rely on the transfer safeguards the law provides, such as standard contractual clauses.</p>,
        },
        {
          heading: "How long we keep it",
          body: <p>Workspace data is kept while your workspace is active. When you close it, we delete workspace data within 30 days of your written request, and backups expire on their normal schedule. Billing records are kept as long as tax and accounting law requires.</p>,
        },
        {
          heading: "Security",
          body: <p>Each workspace&apos;s data is separated at the database level, data is encrypted in transit, ERP credentials are encrypted before storage, and every change to an order is recorded in an audit log. No system is perfectly secure; we will notify you without undue delay if we learn of a breach affecting your data.</p>,
        },
        {
          heading: "Your choices and rights",
          body: (
            <p>
              Depending on where you live, you may have rights to access, correct, delete or export your personal data, and to object to or restrict some uses.
              Write to {l.email}. If your data is in a workspace run by a company you deal with, we will pass your request to that company. You can also complain
              to your data protection authority.
            </p>
          ),
        },
        {
          heading: "Cookies",
          body: <p>We use cookies that are necessary to sign you in and keep your session. If we add analytics, they will be listed here before they are switched on.</p>,
        },
        {
          heading: "Changes",
          body: <p>We will post changes here and, if they are material, tell workspace owners by email before they apply.</p>,
        },
      ]}
    />
  );
}
