import { serve } from "inngest/next";
import { isInngestConfigured } from "@/lib/env";
import { functions, inngest } from "@/lib/server/inngest";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Inngest calls this endpoint to register and run the durable pipeline functions
 * (plan §7.1). Without Inngest keys the endpoint answers 503 and the pipeline runs
 * in the web process instead (lib/server/dispatch.ts).
 */
const handlers = serve({ client: inngest, functions });
const configured = () => isInngestConfigured() || Boolean(process.env.INNGEST_SIGNING_KEY);
const off = () => Response.json({ error: "Inngest is not configured" }, { status: 503 });

type Handler = (typeof handlers)["GET"];
const gate =
  (h: Handler): Handler =>
  (...args) =>
    configured() ? h(...args) : Promise.resolve(off());

export const GET = gate(handlers.GET);
export const POST = gate(handlers.POST);
export const PUT = gate(handlers.PUT);
