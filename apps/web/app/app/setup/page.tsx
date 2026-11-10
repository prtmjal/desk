import type { Metadata } from "next";
import { CreateOrganization } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { isClerkConfigured } from "@/lib/env";
import { getSession } from "@/lib/server/session";

export const metadata: Metadata = { title: "Set up your company" };

/** Signed in but not in an organization yet: every tenant is an organization. */
export default async function SetupPage() {
  const session = await getSession();
  if (session) redirect("/app");
  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Set up your company</h1>
      <p className="mt-1 max-w-xl text-sm text-muted">
        DESK keeps each company&apos;s items, customers and orders in its own workspace. Create one for your company, or ask a colleague to
        invite you to theirs, then pick it in the switcher on the left.
      </p>
      {isClerkConfigured() ? (
        <div className="mt-6">
          <CreateOrganization afterCreateOrganizationUrl="/app" skipInvitationScreen />
        </div>
      ) : null}
    </div>
  );
}
