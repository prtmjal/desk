import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";
import { ClerkNotConfigured } from "@/components/clerk-not-configured";
import { isClerkConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Sign up", robots: { index: false } };

export default function SignUpPage() {
  if (!isClerkConfigured()) return <ClerkNotConfigured feature="Sign up" />;
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <SignUp />
    </main>
  );
}
