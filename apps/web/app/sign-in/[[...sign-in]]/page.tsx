import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";
import { ClerkNotConfigured } from "@/components/clerk-not-configured";
import { isClerkConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default function SignInPage() {
  if (!isClerkConfigured()) return <ClerkNotConfigured feature="Sign in" />;
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <SignIn />
    </main>
  );
}
