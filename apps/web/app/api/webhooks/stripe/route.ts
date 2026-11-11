import type Stripe from "stripe";
import { isStripeConfigured } from "@/lib/env";
import { stripe, syncInvoice, syncSubscription } from "@/lib/server/billing";
import { getDeps } from "@/lib/server/deps";

export const runtime = "nodejs";

/**
 * Stripe webhook: keeps `subscriptions`, `invoices` and the tenant's plan in step with
 * Stripe (plan §8). Handlers are idempotent upserts, so Stripe's retries are harmless.
 */
export async function POST(req: Request): Promise<Response> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!isStripeConfigured() || !secret) return Response.json({ error: "Stripe webhook is not configured" }, { status: 503 });

  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(await req.text(), req.headers.get("stripe-signature") ?? "", secret);
  } catch (err) {
    console.warn("[stripe-webhook] verification failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  const deps = await getDeps();
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (subId) await syncSubscription(deps, await stripe().subscriptions.retrieve(subId));
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(deps, event.data.object);
      break;
    case "invoice.finalized":
    case "invoice.paid":
    case "invoice.payment_failed":
    case "invoice.voided":
      await syncInvoice(deps, event.data.object);
      break;
    default:
      break;
  }
  return Response.json({ received: true });
}
