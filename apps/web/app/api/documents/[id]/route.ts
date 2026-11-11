import { documents, withTenant } from "@desk/db";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/server/session";

export const runtime = "nodejs";

/** Serve a source document to the review screen. Tenant-scoped; never rendered as active content. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const { deps, tenantId } = session;
  const doc = await withTenant(deps.db, tenantId, async (tx) => (await tx.select().from(documents).where(and(eq(documents.tenantId, tenantId), eq(documents.id, id))))[0]);
  const blob = doc?.storageRef ? await deps.blobs.get(doc.storageRef) : null;
  if (!doc || !blob) return new Response("Not found", { status: 404 });

  const type = doc.mimeType ?? blob.contentType ?? "application/octet-stream";
  // Only PDFs and raster images render inline; everything else downloads or shows as text.
  const inline = type === "application/pdf" || /^image\/(png|jpeg|gif|webp)$/.test(type);
  const asText = /^text\/(plain|csv)/.test(type);
  return new Response(blob.bytes as unknown as BodyInit, {
    headers: {
      "content-type": inline ? type : asText ? "text/plain; charset=utf-8" : "application/octet-stream",
      "content-disposition": `${inline || asText ? "inline" : "attachment"}; filename="${encodeURIComponent(doc.filename)}"`,
      "x-content-type-options": "nosniff",
      // PDFs and images are inert and need the browser's own viewer; everything else is sandboxed.
      ...(inline ? {} : { "content-security-policy": "sandbox; default-src 'none'" }),
      "cache-control": "private, max-age=300",
    },
  });
}
