import type { CatalogItem, ExtractedLine, ExtractedOrder, ExtractionOutput } from "@desk/core";
import type { ClassificationOutput, LlmClient, LlmResult, RerankOutput } from "../llm";
import type { NormalizedDocument } from "../normalize/types";
import { address, extractedLine, num, str } from "./fixtures";

const cost = () => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0, calls: 1 });

/**
 * DEMO ONLY. A rule-based stand-in for the model so the app can be explored with no
 * ANTHROPIC_API_KEY (demo mode) and so end-to-end tests run offline. It reads plain text
 * and CSV/spreadsheet text for a PO number and "qty / part / description / price" rows.
 * It cannot read PDFs or images and is deliberately modest about its confidence, so
 * everything it produces lands in the review queue rather than auto-posting.
 */
export class HeuristicLlm implements LlmClient {
  async classify(doc: NormalizedDocument): Promise<LlmResult<ClassificationOutput>> {
    const text = allText(doc).toLowerCase();
    const looksLikeQuote = /\b(quote|rfq|pricing on|price check|how much)\b/.test(text) && !/\bpo\b|purchase order/.test(text);
    const looksLikeStatus = /\b(where is my order|tracking|status of (my|our) order|eta)\b/.test(text);
    const documentType = looksLikeStatus ? "status_inquiry" : looksLikeQuote ? "quote_request" : parseLines(text).length > 0 ? "order" : "other";
    return {
      output: { documentType, confidence: documentType === "order" ? 0.8 : 0.92, hasAttachments: doc.parts.length > 1, estimatedOrderCount: documentType === "order" ? 1 : 0, rationale: "demo heuristic" },
      cost: cost(),
      model: "demo-heuristic",
      promptVersion: "classify.demo",
      stopReason: "end_turn",
    };
  }

  async extract(doc: NormalizedDocument): Promise<LlmResult<ExtractionOutput>> {
    const text = allText(doc);
    const lines = parseLines(text);
    // "PO" must stand alone (not the start of "Point") and the number must contain a digit.
    const po = text.match(/\b(?:P\.?O\.?(?![a-z])|purchase order)\s*(?:number|no\.?|#)?\s*[:#,]?\s*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{2,})/i)?.[1] ?? null;
    const shipDate = text.match(/\b(?:ship|need|deliver|required)\s*(?:by|date)?\s*[:,]?\s*(\d{4}-\d{2}-\d{2})/i)?.[1] ?? null;
    const empty = str(null, 0);
    const order: ExtractedOrder = {
      poNumber: str(po, 0.9),
      orderDate: empty,
      requestedShipDate: str(shipDate, 0.85),
      customer: { name: empty, accountNumber: empty, contactName: empty, email: str(doc.sender, 0.9), phone: empty },
      billTo: address(),
      shipTo: address(),
      paymentTerms: empty,
      shippingMethod: empty,
      currency: empty,
      subtotal: num(null, 0),
      tax: num(null, 0),
      freight: num(null, 0),
      total: num(null, 0),
      specialInstructions: empty,
      lines,
      pageRange: null,
    };
    const output: ExtractionOutput = {
      documentType: lines.length > 0 ? "order" : "other",
      documentTypeConfidence: lines.length > 0 ? 0.8 : 0.6,
      language: "en",
      orders: lines.length > 0 ? [order] : [],
      warnings: ["Extracted by the offline demo parser, not the model. Set ANTHROPIC_API_KEY for real extraction."],
    };
    return { output, cost: cost(), model: "demo-heuristic", promptVersion: "extract-order.demo", stopReason: "end_turn" };
  }

  async rerank(_input: { line: ExtractedLine; documentContext: string | null; candidates: CatalogItem[] }): Promise<LlmResult<RerankOutput>> {
    return { output: { itemId: null, confidence: 0, reason: "Several items resemble this line" }, cost: cost(), model: "demo-heuristic", promptVersion: "rerank.demo", stopReason: "end_turn" };
  }
}

function allText(doc: NormalizedDocument): string {
  return doc.parts
    .map((p) => (p.kind === "text" ? p.text : p.kind === "pdf" ? p.textPreview : ""))
    .join("\n");
}

const UOM = "ea|each|pc|pcs|cs|case|cases|bx|box|boxes|pk|pack|rl|roll|rolls|ft|bdl|bundle|bundles";

/** Rows such as `2,WIRE-12,12 AWG black,CS,358.00` or `10 x EMT-075-10 3/4 EMT @ 9.80` or `20 boxes yellow wire nuts`. */
function parseLines(text: string): ExtractedLine[] {
  const out: ExtractedLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const row = raw.trim();
    if (!row || /^(line|part|qty|item|sku)\b.*\b(qty|quantity|description|price)\b/i.test(row)) continue;

    // Delimited row (CSV, tab or pipe separated).
    const cells = row.split(/\s*[,\t|]\s*/).filter((c) => c.length > 0);
    if (cells.length >= 3) {
      const parsed = fromCells(cells, out.length + 1);
      if (parsed) {
        out.push(parsed);
        continue;
      }
    }

    // Free text: "<qty> [uom] [x] <part?> <description> [@ price]".
    const m = row.match(new RegExp(`^(?:[-*•]\\s*)?(\\d+(?:\\.\\d+)?)\\s*(${UOM})?\\b\\.?\\s*(?:x|of|-)?\\s+(.+?)(?:\\s*@\\s*\\$?(\\d+(?:\\.\\d+)?))?$`, "i"));
    if (m && m[3] && /[a-z]/i.test(m[3])) {
      const rest = m[3].trim();
      const partMatch = rest.match(/^([A-Z0-9]+(?:-[A-Z0-9]+)+)\s*(.*)$/);
      out.push(
        extractedLine(out.length + 1, {
          part: partMatch ? partMatch[1]! : null,
          desc: (partMatch ? partMatch[2] : rest) || null,
          qty: Number(m[1]),
          uom: m[2] ?? null,
          price: m[4] ? Number(m[4]) : null,
        }),
      );
    }
  }
  return out;
}

function fromCells(cells: string[], lineNo: number): ExtractedLine | null {
  const isNum = (c: string) => /^\$?\d+(?:\.\d+)?$/.test(c);
  const isUom = (c: string) => new RegExp(`^(${UOM})$`, "i").test(c);
  const isPart = (c: string) => /^[A-Z0-9]+(?:[-/][A-Z0-9]+)+$/i.test(c) || /^\d{11,14}$/.test(c);
  let work = [...cells];
  // Leading line number followed by a part number.
  if (work.length >= 4 && /^\d{1,3}$/.test(work[0]!) && isPart(work[1]!)) work = work.slice(1);
  const part = work.find(isPart) ?? null;
  if (!part) return null;
  const rest = work.filter((c) => c !== part);
  const uom = rest.find(isUom) ?? null;
  const nums = rest.filter((c) => isNum(c) && c !== uom).map((c) => Number(c.replace("$", "")));
  const desc = rest.find((c) => !isNum(c) && !isUom(c) && /[a-z]{3}/i.test(c)) ?? null;
  if (nums.length === 0) return null;
  const qty = nums[0]!;
  const price = nums.length > 1 ? nums[1]! : null;
  return extractedLine(lineNo, { part, desc, qty, uom, price });
}
