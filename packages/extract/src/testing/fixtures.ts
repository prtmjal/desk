import type { CatalogItem, CustomerRecord, ExtractedAddress, ExtractedLine, ExtractedOrder, ExtractionOutput, NumberField, StringField, ValidationContext } from "@desk/core";
import { InMemoryCatalog } from "@desk/core";

export const str = (value: string | null, confidence = 0.98): StringField => ({ value, confidence, provenance: value ? { page: 1, quote: value } : null });
export const num = (value: number | null, confidence = 0.98): NumberField => ({ value, confidence, provenance: value !== null ? { page: 1, quote: String(value) } : null });

export function address(p: Partial<Record<keyof ExtractedAddress, string | null>> = {}): ExtractedAddress {
  return {
    name: str(p.name ?? null, p.name ? 0.95 : 0),
    attention: str(p.attention ?? null, p.attention ? 0.95 : 0),
    line1: str(p.line1 ?? null, p.line1 ? 0.95 : 0),
    line2: str(p.line2 ?? null, p.line2 ? 0.95 : 0),
    city: str(p.city ?? null, p.city ? 0.95 : 0),
    region: str(p.region ?? null, p.region ? 0.95 : 0),
    postalCode: str(p.postalCode ?? null, p.postalCode ? 0.95 : 0),
    country: str(p.country ?? null, p.country ? 0.95 : 0),
  };
}

export function extractedLine(lineNo: number, p: { part?: string | null; desc?: string | null; qty?: number | null; uom?: string | null; price?: number | null; ext?: number | null; notes?: string | null }): ExtractedLine {
  return {
    lineNo,
    customerLineRef: str(null, 0),
    rawPartNumber: str(p.part ?? null, p.part ? 0.97 : 0.9),
    rawDescription: str(p.desc ?? null, p.desc ? 0.97 : 0.9),
    quantity: num(p.qty ?? null, p.qty !== undefined && p.qty !== null ? 0.99 : 0.2),
    rawUom: str(p.uom ?? null, p.uom ? 0.95 : 0.7),
    unitPrice: num(p.price ?? null, p.price !== undefined && p.price !== null ? 0.96 : 0.9),
    extendedPrice: num(p.ext ?? null, p.ext !== undefined && p.ext !== null ? 0.96 : 0.9),
    requestedDate: str(null, 0.9),
    notes: str(p.notes ?? null, p.notes ? 0.9 : 0.9),
  };
}

export function extractedOrder(p: { po?: string | null; customerName?: string | null; account?: string | null; email?: string | null; lines: ExtractedLine[]; subtotal?: number | null }): ExtractedOrder {
  const addr = address({ name: p.customerName ?? null, line1: "100 Industrial Pkwy", city: "Dallas", region: "TX", postalCode: "75201", country: "US" });
  return {
    poNumber: str(p.po === undefined ? "PO-4471" : p.po, 0.99),
    orderDate: str("2026-11-05", 0.97),
    requestedShipDate: str("2026-11-12", 0.9),
    customer: { name: str(p.customerName ?? null, p.customerName ? 0.95 : 0), accountNumber: str(p.account ?? null, p.account ? 0.95 : 0.9), contactName: str(null, 0.9), email: str(p.email ?? null, p.email ? 0.95 : 0.9), phone: str(null, 0.9) },
    billTo: addr,
    shipTo: addr,
    paymentTerms: str("Net 30", 0.9),
    shippingMethod: str(null, 0.9),
    currency: str("USD", 0.9),
    subtotal: num(p.subtotal ?? null, p.subtotal !== undefined && p.subtotal !== null ? 0.95 : 0.9),
    tax: num(null, 0.9),
    freight: num(null, 0.9),
    total: num(null, 0.9),
    specialInstructions: str(null, 0.9),
    lines: p.lines,
    pageRange: { from: 1, to: 1 },
  };
}

export function extraction(orders: ExtractedOrder[], documentType: ExtractionOutput["documentType"] = "order"): ExtractionOutput {
  return { documentType, documentTypeConfidence: 0.97, language: "en", orders, warnings: [] };
}

export const DEMO_ITEMS: CatalogItem[] = [
  { id: "i1", sku: "THHN-12-BLK-500", upc: "012345678905", mpn: "T12BK500", description: "THHN 12 AWG Stranded Copper Wire Black 500ft Spool", active: true, pack: { baseUom: "EA", factors: { CS: 4 } }, listPrice: 89.5 },
  { id: "i2", sku: "THHN-12-RED-500", upc: "012345678912", mpn: "T12RD500", description: "THHN 12 AWG Stranded Copper Wire Red 500ft Spool", active: true, pack: { baseUom: "EA", factors: { CS: 4 } }, listPrice: 89.5 },
  { id: "i3", sku: "EMT-075-10", upc: "012345678929", mpn: "EMT34", description: '3/4" EMT Conduit 10ft', active: true, pack: { baseUom: "EA", factors: { BD: 100 }, multipleOf: 10 }, listPrice: 6.1 },
  { id: "i4", sku: "WN-YEL-100", upc: "012345678936", mpn: "30-074", description: "Yellow Wing Wire Connectors 100/Box", active: true, pack: { baseUom: "BX", factors: { CS: 10 } }, listPrice: 7.25 },
  { id: "i5", sku: "WN-RED-100", upc: "012345678943", mpn: "30-076", description: "Red Wing Wire Connectors 100/Box", active: true, pack: { baseUom: "BX", factors: { CS: 10 } }, listPrice: 7.25 },
  { id: "i6", sku: "BOX-4SQ-D", upc: "012345678950", mpn: "52171-K", description: '4" Square Box 2-1/8" Deep Steel', active: true, pack: { baseUom: "EA", factors: { CS: 50 } }, listPrice: 2.4 },
  { id: "i8", sku: "GFCI-20-WH", upc: "012345678967", mpn: "GFNT2-W", description: "20A GFCI Receptacle White Tamper Resistant", active: true, pack: { baseUom: "EA", factors: { BX: 10 } }, listPrice: 18.9 },
];

export const DEMO_CUSTOMERS: CustomerRecord[] = [
  { id: "c1", name: "Acme Electric Contractors", domains: ["acmeelectric.com"], accountNumber: "AC-1001", active: true },
  { id: "c2", name: "Bright Lights Inc", domains: ["brightlights.com"], accountNumber: "BL-2002", active: true },
];

/** Validation facts derived from the in-memory catalog: list prices, no stock tracking, no duplicates. */
export function validationFromCatalog(catalog: InMemoryCatalog, customers: CustomerRecord[], opts: { existingPos?: Set<string> } = {}): ValidationContext {
  return {
    getItem: (id) => catalog.getById(id),
    getPrice: async (_customerId, itemId) => (await catalog.getById(itemId))?.listPrice ?? null,
    getStock: async () => null,
    isDuplicatePo: async (customerId, po) => opts.existingPos?.has(`${customerId ?? ""}:${po}`) ?? false,
    customerOnCreditHold: async (id) => customers.find((c) => c.id === id)?.creditHold ?? false,
  };
}
