import type { NextRequest } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import Stripe from "stripe";
import { isStripeConfigured } from "@/lib/env";

export const runtime = "nodejs";

/**
 * Clerk webhook receiver. Phase 0 handles one event:
 *   organization.created -> create the matching Stripe customer (plan §7.5).
 *
 * Gating: without CLERK_WEBHOOK_SECRET the route answers 503 (nothing is
 * verified, nothing is processed). Without STRIPE_SECRET_KEY the event is
 * acknowledged and logged but no customer is created.
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
      if (!isStripeConfigured()) {
        console.log(`[clerk-webhook] organization.created ${id} (${slug}); Stripe not configured, skipping customer`);
        break;
      }
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
      const customer = await stripe.customers.create(
        {
          name,
          metadata: { clerkOrgId: id, clerkOrgSlug: slug },
        },
        // Clerk retries on non-2xx; the idempotency key keeps one customer per org.
        { idempotencyKey: `clerk-org-created-${id}` },
      );
      console.log(`[clerk-webhook] organization.created ${id} -> stripe customer ${customer.id}`);
      break;
    }
    default:
      console.log(`[clerk-webhook] ignored ${event.type}`);
  }

  return Response.json({ received: true });
}
