import type Anthropic from "@anthropic-ai/sdk";
import type { NormalizedDocument } from "./types";

/**
 * Turn a normalized document into Messages API content blocks. Native PDF and image
 * input for documents (plan §6.6); spreadsheets/CSV/DOCX/email bodies arrive as text.
 */
export function documentToContentBlocks(
  doc: NormalizedDocument,
  opts: { firstPageOnly?: boolean; maxTextChars?: number },
): Anthropic.Messages.ContentBlockParam[] {
  const blocks: Anthropic.Messages.ContentBlockParam[] = [];
  const header = [
    doc.sender ? `From: ${doc.sender}` : null,
    doc.subject ? `Subject: ${doc.subject}` : null,
    doc.receivedAt ? `Received: ${doc.receivedAt}` : null,
    doc.rejected.length ? `Unreadable attachments: ${doc.rejected.map((r) => `${r.filename} (${r.reason})`).join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  if (header) blocks.push({ type: "text", text: header });

  doc.parts.forEach((part, i) => {
    const label = `=== Attachment ${i + 1}: ${part.label} ===`;
    if (part.kind === "text") {
      const text = opts.maxTextChars && part.text.length > opts.maxTextChars ? part.text.slice(0, opts.maxTextChars) + "\n[truncated]" : part.text;
      blocks.push({ type: "text", text: `${label}\n${text}` });
    } else if (part.kind === "pdf") {
      if (opts.firstPageOnly) {
        // Cheap routing: text preview only, no page images.
        blocks.push({ type: "text", text: `${label} (PDF, ${part.pages} pages${part.hasTextLayer ? "" : ", scanned"})\n${part.textPreview}` });
      } else {
        blocks.push({ type: "text", text: label });
        blocks.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: part.base64 },
          title: part.label,
        });
      }
    } else {
      blocks.push({ type: "text", text: label });
      blocks.push({ type: "image", source: { type: "base64", media_type: part.mediaType, data: part.base64 } });
    }
  });

  if (blocks.length === 0) blocks.push({ type: "text", text: "(empty message)" });
  return blocks;
}

/** Plain-text rendering of the document for the re-ranker's context window (short). */
export function documentContextText(doc: NormalizedDocument, maxChars = 2000): string {
  const out: string[] = [];
  if (doc.subject) out.push(`Subject: ${doc.subject}`);
  for (const p of doc.parts) {
    if (p.kind === "text") out.push(p.text);
    else if (p.kind === "pdf") out.push(p.textPreview);
  }
  const s = out.join("\n");
  return s.length > maxChars ? s.slice(0, maxChars) : s;
}
