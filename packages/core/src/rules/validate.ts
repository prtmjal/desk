import type { DraftLine, OrderHeader, ValidationIssue, CustomerMatch } from "../schema/index.js";
import type { CatalogItem } from "../matching/catalog.js";
import { applyPackRules, resolveUom } from "../matching/uom.js";

/**
 * ERP-side facts the validator needs. Provided by the connector (or fixtures);
 * the validator itself is pure.
 */
export interface ValidationContext {
  getItem(itemId: string): Promise<CatalogItem | undefined>;
  /** Contract/list price for this customer+item in base UoM, or null when none. */
  getPrice(customerId: string | null, itemId: string): Promise<number | null>;
  /** Available-to-promise in base UoM, or null when unknown/not tracked. */
  getStock(itemId: string): Promise<number | null>;
  /** True when an open order with this PO number already exists for the customer. */
  isDuplicatePo(customerId: string | null, poNumber: string): Promise<boolean>;
  customerOnCreditHold(customerId: string): Promise<boolean>;
}

export type ValidationPolicy = {
  /** Allowed |PO price - list price| / list price before flagging. Plan §6.2 default 2%. */
  priceTolerancePct: number;
  /** Flag a line when its extracted confidence is below this. */
  lineConfidenceFloor: number;
  /** Flag the header when overall header confidence is below this. */
  headerConfidenceFloor: number;
  /** Whether missing stock is an error (hold) or a warning (backorder allowed). */
  stockShortSeverity: "warning" | "error";
  /** Allowed subtotal mismatch between sum of lines and printed subtotal, absolute currency units. */
  totalsToleranceAbs: number;
};

export const DEFAULT_POLICY: ValidationPolicy = {
  priceTolerancePct: 2,
  lineConfidenceFloor: 0.9,
  headerConfidenceFloor: 0.85,
  stockShortSeverity: "warning",
  totalsToleranceAbs: 1,
};

const issue = (
  code: ValidationIssue["code"],
  severity: ValidationIssue["severity"],
  message: string,
  lineNo: number | null = null,
  data: Record<string, unknown> = {},
): ValidationIssue => ({ code, severity, lineNo, message, data });

/** Validate and enrich one line in place-safe fashion: returns a new line. */
export async function validateLine(
  line: DraftLine,
  customer: CustomerMatch,
  ctx: ValidationContext,
  policy: ValidationPolicy = DEFAULT_POLICY,
): Promise<DraftLine> {
  const issues: ValidationIssue[] = [];
  let erpQuantity: number | null = null;
  let listPrice: number | null = null;
  let priceDeltaPct: number | null = null;

  const qty = line.quantity.value;
  if (qty === null || !(qty > 0)) {
    issues.push(issue("QTY_MISSING", "error", "Quantity missing or not positive", line.lineNo));
  }

  if (line.match.status === "unmatched") {
    issues.push(issue("ITEM_UNMATCHED", "error", line.match.abstainReason ?? "No matching item", line.lineNo));
  } else if (line.match.status === "ambiguous") {
    issues.push(
      issue("ITEM_AMBIGUOUS", "error", line.match.abstainReason ?? "Several possible items", line.lineNo, {
        candidates: line.match.candidates.map((c) => c.sku),
      }),
    );
  } else if (line.match.status === "matched" && line.match.best) {
    const item = await ctx.getItem(line.match.best.itemId);
    if (!item) {
      issues.push(issue("ITEM_UNMATCHED", "error", "Matched item no longer exists in ERP", line.lineNo));
    } else {
      if (!item.active) issues.push(issue("ITEM_INACTIVE", "error", `Item ${item.sku} is inactive`, line.lineNo));

      // UoM / pack
      const uom = resolveUom(line.rawUom.value, item.pack);
      if (!uom.ok) {
        issues.push(issue("UOM_UNKNOWN", "error", uom.reason, line.lineNo));
      } else if (qty !== null && qty > 0) {
        const factor = line.match.uomFactor ?? uom.factor;
        const base = qty * factor;
        const rounded = applyPackRules(base, item.pack);
        erpQuantity = rounded.qty;
        if (rounded.rounded) {
          issues.push(issue("PACK_ROUNDING", "warning", rounded.note ?? "Quantity adjusted to pack rules", line.lineNo, { from: base, to: rounded.qty }));
        }
        if (uom.note) {
          issues.push(issue("UOM_UNKNOWN", "info", uom.note, line.lineNo));
        }
      }

      // Price
      listPrice = await ctx.getPrice(customer.customerId, item.id);
      const poPrice = line.unitPrice.value;
      if (poPrice !== null && listPrice !== null && listPrice > 0) {
        // Compare in the same unit: PO price is per ordered UoM; list is per base UoM.
        const factor = line.match.uomFactor ?? 1;
        const poPerBase = poPrice / factor;
        priceDeltaPct = ((poPerBase - listPrice) / listPrice) * 100;
        if (Math.abs(priceDeltaPct) > policy.priceTolerancePct) {
          issues.push(
            issue("PRICE_MISMATCH", "error", `PO price ${poPrice} vs list ${listPrice} (${priceDeltaPct.toFixed(1)}%)`, line.lineNo, {
              poPrice,
              listPrice,
              deltaPct: priceDeltaPct,
            }),
          );
        }
      } else if (listPrice === null) {
        issues.push(issue("PRICE_MISSING", "warning", "No list/contract price found for this item", line.lineNo));
      }

      // Stock
      const stock = await ctx.getStock(item.id);
      if (stock !== null && erpQuantity !== null && stock < erpQuantity) {
        issues.push(
          issue("STOCK_SHORT", policy.stockShortSeverity, `Only ${stock} available for ${erpQuantity} requested`, line.lineNo, {
            available: stock,
            requested: erpQuantity,
          }),
        );
      }
    }
  }

  // Confidence
  const conf = lineConfidence(line);
  if (conf < policy.lineConfidenceFloor) {
    issues.push(issue("LOW_CONFIDENCE", "warning", `Line extracted with confidence ${conf.toFixed(2)}`, line.lineNo));
  }

  return { ...line, erpQuantity, listPrice, priceDeltaPct, issues };
}

export async function validateHeader(
  header: OrderHeader,
  customer: CustomerMatch,
  lines: DraftLine[],
  ctx: ValidationContext,
  policy: ValidationPolicy = DEFAULT_POLICY,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  if (!customer.customerId) {
    issues.push(
      issue("CUSTOMER_UNKNOWN", "error", "Could not identify the customer", null, {
        candidates: customer.candidates,
      }),
    );
  } else if (await ctx.customerOnCreditHold(customer.customerId)) {
    issues.push(issue("CUSTOMER_CREDIT_HOLD", "error", "Customer is on credit hold"));
  }

  const po = header.poNumber.value;
  if (!po) {
    issues.push(issue("PO_MISSING", "warning", "No PO number found on the document"));
  } else if (await ctx.isDuplicatePo(customer.customerId, po)) {
    issues.push(issue("DUPLICATE_PO", "error", `PO ${po} already exists for this customer`, null, { poNumber: po }));
  }

  // Totals sanity: sum of extended prices vs printed subtotal.
  const printed = header.subtotal.value ?? (header.total.value !== null && header.tax.value === null && header.freight.value === null ? header.total.value : null);
  const sum = lines.reduce((acc, l) => {
    const ext = l.extendedPrice.value ?? (l.quantity.value !== null && l.unitPrice.value !== null ? l.quantity.value * l.unitPrice.value : null);
    return ext === null ? acc : acc + ext;
  }, 0);
  if (printed !== null && lines.length > 0 && Math.abs(printed - sum) > policy.totalsToleranceAbs) {
    issues.push(
      issue("TOTALS_MISMATCH", "warning", `Lines sum to ${sum.toFixed(2)} but document shows ${printed.toFixed(2)}`, null, {
        sum,
        printed,
      }),
    );
  }

  const conf = headerConfidence(header);
  if (conf < policy.headerConfidenceFloor) {
    issues.push(issue("LOW_CONFIDENCE", "warning", `Header extracted with confidence ${conf.toFixed(2)}`));
  }

  return issues;
}

/** Mean confidence of the fields that matter on a line (qty, part/desc, price if present). */
export function lineConfidence(line: Pick<DraftLine, "quantity" | "rawPartNumber" | "rawDescription" | "unitPrice" | "match">): number {
  const parts: number[] = [line.quantity.confidence];
  const idConf = Math.max(
    line.rawPartNumber.value ? line.rawPartNumber.confidence : 0,
    line.rawDescription.value ? line.rawDescription.confidence : 0,
  );
  parts.push(idConf);
  if (line.unitPrice.value !== null) parts.push(line.unitPrice.confidence);
  if (line.match.status === "matched" && line.match.best) parts.push(line.match.best.score);
  else if (line.match.status !== "skipped") parts.push(0);
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

/** Header confidence = weighted mean of PO number, customer name, ship-to, dates. */
export function headerConfidence(h: OrderHeader): number {
  const weighted: Array<[number, number]> = [
    [h.poNumber.confidence, 3],
    [h.customer.name.confidence, 2],
    [h.shipTo.line1.value ? h.shipTo.line1.confidence : h.shipTo.name.confidence, 2],
    [h.orderDate.value ? h.orderDate.confidence : 0.8, 1],
    [h.requestedShipDate.value ? h.requestedShipDate.confidence : 0.8, 1],
  ];
  const num = weighted.reduce((a, [c, w]) => a + c * w, 0);
  const den = weighted.reduce((a, [, w]) => a + w, 0);
  return num / den;
}
