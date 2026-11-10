import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { APP_NAV } from "@/components/app-nav";

type Props = { params: Promise<{ section: string[] }> };

function findSection(segments: string[]) {
  const href = `/app/${segments.join("/")}`;
  return APP_NAV.find((item) => item.href !== "/app" && href.startsWith(item.href));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { section } = await params;
  const item = findSection(section);
  return { title: item?.label ?? "Not found" };
}

/**
 * Placeholder for the application sections listed in the left nav. Each one
 * ships with the MVP (plan §7.5 Phase 2); for now they explain what will be here.
 */
export default async function AppSectionPage({ params }: Props) {
  const { section } = await params;
  const item = findSection(section);
  if (!item) notFound();

  return (
    <div className="container-page py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{item.label}</h1>
      <p className="mt-1 text-sm text-muted">{item.hint}</p>
      <div className="card mt-8 max-w-xl">
        <p className="font-medium">Arrives with the MVP</p>
        <p className="mt-1 text-sm text-muted">
          This section is part of the Phase 2 build: review queue, posted and rejected lists, customer
          aliases and rules, item master, and settings for your ERP connection, intake address, users
          and billing.
        </p>
        <Link href="/app" className="btn-secondary mt-4">
          Back to Inbox
        </Link>
      </div>
    </div>
  );
}
