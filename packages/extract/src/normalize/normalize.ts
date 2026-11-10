import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import type { DocPart, NormalizedDocument, RawAttachment, RawInput } from "./types.js";

const IMAGE_TYPES: Record<string, "image/png" | "image/jpeg" | "image/gif" | "image/webp"> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

const MAX_PDF_BYTES = 30 * 1024 * 1024; // API request limit is 32 MB
const MAX_PDF_PAGES = 100;
const MAX_SHEET_ROWS = 2000;

export function extensionOf(filename: string): string {
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1]! : "";
}

export function sha256(parts: Array<Uint8Array | string>): string {
  const h = createHash("sha256");
  for (const p of parts) h.update(typeof p === "string" ? Buffer.from(p, "utf8") : p);
  return h.digest("hex");
}

/**
 * Normalize an inbound email or upload into model-ready parts.
 * Deterministic: same bytes → same id and same parts, so pipeline runs are replayable (plan §7.3 #2).
 */
export async function normalizeInput(raw: RawInput): Promise<NormalizedDocument> {
  const parts: DocPart[] = [];
  const rejected: NormalizedDocument["rejected"] = [];

  const body = raw.bodyText?.trim();
  if (body) parts.push({ kind: "text", label: "email body", text: stripQuotedReplies(body) });

  for (const att of raw.attachments) {
    try {
      const part = await normalizeAttachment(att);
      if (part) parts.push(part);
      else rejected.push({ filename: att.filename, reason: "unsupported file type" });
    } catch (err) {
      rejected.push({ filename: att.filename, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  const id = sha256([
    raw.sender ?? "",
    raw.subject ?? "",
    raw.bodyText ?? "",
    ...raw.attachments.flatMap((a) => [a.filename, a.bytes]),
  ]);

  return {
    id,
    source: raw.source,
    sender: raw.sender ?? null,
    subject: raw.subject ?? null,
    receivedAt: raw.receivedAt ?? null,
    parts,
    rejected,
  };
}

export async function normalizeAttachment(att: RawAttachment): Promise<DocPart | null> {
  const ext = extensionOf(att.filename);
  const mime = (att.mimeType ?? "").toLowerCase();

  if (ext === "pdf" || mime === "application/pdf") return await normalizePdf(att);
  if (IMAGE_TYPES[ext] || mime.startsWith("image/")) {
    const mediaType = IMAGE_TYPES[ext] ?? (mime as DocPart extends { mediaType: infer M } ? M : never);
    if (!Object.values(IMAGE_TYPES).includes(mediaType as never)) return null;
    return { kind: "image", label: att.filename, base64: Buffer.from(att.bytes).toString("base64"), mediaType: mediaType as "image/png" };
  }
  if (ext === "xlsx" || ext === "xlsm" || mime.includes("spreadsheetml")) return await normalizeXlsx(att);
  if (ext === "xls") throw new Error("legacy .xls not supported; ask for .xlsx or CSV");
  if (ext === "csv" || ext === "tsv" || mime === "text/csv") return normalizeCsv(att);
  if (ext === "txt" || ext === "eml" || mime.startsWith("text/plain")) {
    return { kind: "text", label: att.filename, text: Buffer.from(att.bytes).toString("utf8") };
  }
  if (ext === "docx" || mime.includes("wordprocessingml")) {
    const r = await mammoth.extractRawText({ buffer: Buffer.from(att.bytes) });
    return { kind: "text", label: att.filename, text: r.value };
  }
  if (ext === "html" || ext === "htm" || mime === "text/html") {
    return { kind: "text", label: att.filename, text: htmlToText(Buffer.from(att.bytes).toString("utf8")) };
  }
  return null;
}

async function normalizePdf(att: RawAttachment): Promise<DocPart> {
  if (att.bytes.byteLength > MAX_PDF_BYTES) throw new Error(`PDF larger than ${MAX_PDF_BYTES / 1024 / 1024} MB`);
  // Copy: pdf.js detaches the buffer it is given.
  const pdf = await getDocumentProxy(new Uint8Array(att.bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  if (totalPages > MAX_PDF_PAGES) throw new Error(`PDF has ${totalPages} pages (max ${MAX_PDF_PAGES})`);
  const cleaned = text.replace(/\s+/g, " ").trim();
  // A text layer with fewer than ~20 chars/page is almost certainly a scan.
  const hasTextLayer = cleaned.length >= 20 * Math.max(1, totalPages);
  return {
    kind: "pdf",
    label: att.filename,
    base64: Buffer.from(att.bytes).toString("base64"),
    pages: totalPages,
    hasTextLayer,
    textPreview: cleaned.slice(0, 4000),
  };
}

async function normalizeXlsx(att: RawAttachment): Promise<DocPart> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(att.bytes) as unknown as ExcelJS.Buffer);
  const out: string[] = [];
  wb.eachSheet((ws) => {
    if (ws.state === "hidden" || ws.state === "veryHidden") return;
    out.push(`## Sheet: ${ws.name}`);
    let rows = 0;
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (rows++ >= MAX_SHEET_ROWS) return;
      const cells: string[] = [];
      const values = row.values as ExcelJS.CellValue[];
      for (let c = 1; c < values.length; c++) cells.push(cellToString(values[c]));
      out.push(cells.join("\t").replace(/\t+$/, ""));
    });
    if (rows > MAX_SHEET_ROWS) out.push(`[${rows - MAX_SHEET_ROWS} more rows truncated]`);
  });
  return { kind: "text", label: att.filename, text: out.join("\n") };
}

function cellToString(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("result" in v) return cellToString(v.result as ExcelJS.CellValue);
    if ("text" in v) return String(v.text);
    if ("error" in v) return String(v.error);
    return JSON.stringify(v);
  }
  return String(v);
}

function normalizeCsv(att: RawAttachment): DocPart {
  const text = Buffer.from(att.bytes).toString("utf8").replace(/^﻿/, "");
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
  const rows = parsed.data.slice(0, MAX_SHEET_ROWS).map((r) => r.map((c) => String(c ?? "").trim()).join("\t"));
  if (parsed.data.length > MAX_SHEET_ROWS) rows.push(`[${parsed.data.length - MAX_SHEET_ROWS} more rows truncated]`);
  return { kind: "text", label: att.filename, text: rows.join("\n") };
}

/** Parse CSV text into rows (shared by the CLIs and connectors so there is one CSV dialect handler). */
export function parseCsvRows(text: string): string[][] {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: true });
  return parsed.data.map((r) => r.map((c) => String(c ?? "")));
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Drop quoted previous messages and signatures so the model reads only the new content. */
export function stripQuotedReplies(body: string): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .{5,80} wrote:$/.test(line.trim())) break;
    if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(line.trim())) break;
    if (/^From:\s.+$/.test(line.trim()) && out.length > 0) break;
    if (line.trim() === "--") break;
    out.push(line.replace(/^>+\s?/, ""));
  }
  return out.join("\n").trim();
}
