import "server-only";
import { processMessage } from "@desk/service";
import { after } from "next/server";
import { isInngestConfigured } from "@/lib/env";
import { getDeps } from "./deps";
import { inngest } from "./inngest";

/**
 * Hand a received message to the pipeline. With Inngest configured the work is a
 * durable, retried job (plan §7.1). Without it, the pipeline runs in this process
 * after the response is sent; `processMessage` is idempotent either way.
 */
export async function dispatchProcess(tenantId: string, messageRowId: string): Promise<"queued" | "inline"> {
  if (isInngestConfigured()) {
    await inngest.send({ id: `process-${messageRowId}`, name: "desk/message.received", data: { tenantId, messageRowId } });
    return "queued";
  }
  after(async () => {
    try {
      await processMessage(await getDeps(), tenantId, messageRowId);
    } catch (err) {
      console.error(`[desk] inline processing of ${messageRowId} failed`, err);
    }
  });
  return "inline";
}
