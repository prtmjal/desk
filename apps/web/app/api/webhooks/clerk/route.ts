import type { NextRequest } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { isStripeConfigured } from "@/lib/env";
import { provisionOrganization } from "@/lib/server/billing";
import { getDeps, NotConfiguredError } from "@/lib/server/deps";

export const runtime = "nodejs";

/**
 * Clerk webhook receiver. Handles one event:
 *   organization.created -> create the tenant and its Stripe customer (plan §7.5).
 *
 * Gating: without CLERK_WEBHOOK_SECRET the route answers 503 (nothing is
 * verified, nothing is processed). Without STRIPE_SECRET_KEY the tenant is
 * created and no Stripe customer is; it is created later at checkout.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const signingSecret =
    process.env.CLERK_WEBHOOK_SECRET ?? process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!signingSecret) {
    return Response.json({ error: "Clerk webhook is not configured" }, { status: 503 });
  }

  let event: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    event = await verifyWebhook(req, { signingSecret });
  } catch (err) {
    console.warn("[clerk-webhook] verification failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "organization.created": {
      const { id, name, slug } = event.data;
      try {
        // Creates the tenant (and its Stripe customer when Stripe is configured). Idempotent:
        // Clerk retries on non-2xx, and the app also creates the tenant on first sign-in.
        const tenantId = await provisionOrganization(await getDeps(), { id, name });
        console.log(`[clerk-webhook] organization.created ${id} (${slug}) -> tenant ${tenantId}${isStripeConfigured() ? " + stripe customer" : ""}`);
      } catch (err) {
        if (err instanceof NotConfiguredError) {
          console.log(`[clerk-webhook] organization.created ${id} (${slug}); database not configured, skipping`);
          break;
        }
        console.error("[clerk-webhook] provisioning failed", err);
        return Response.json({ error: "Provisioning failed" }, { status: 500 });
      }
      break;
    }
    default:
      console.log(`[clerk-webhook] ignored ${event.type}`);
  }

  return Response.json({ received: true });
}
