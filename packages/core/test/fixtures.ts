import type { CatalogItem, CustomerRecord, ExtractedLine, StringField, NumberField } from "../src/index.js";

export const str = (value: string | null, confidence = 0.98): StringField => ({ value, confidence, provenance: null });
export const num = (value: number | null, confidence = 0.98): NumberField => ({ value, confidence, provenance: null });

export function line(partial: Partial<ExtractedLine> & { lineNo?: number }): ExtractedLine {
  return {
    lineNo: partial.lineNo ?? 1,
    customerLineRef: str(null, 0),
    rawPartNumber: str(null, 0),
    rawDescription: str(null, 0),
    quantity: num(1),
    rawUom: str("EA"),
    unitPrice: num(null, 0),
    extendedPrice: num(null, 0),
    requestedDate: str(null, 0),
    notes: str(null, 0),
    ...partial,
  };
}

export const ITEMS: CatalogItem[] = [
  { id: "i1", sku: "THHN-12-BLK-500", upc: "012345678905", mpn: "T12BK500", description: "THHN 12 AWG Stranded Copper Wire Black 500ft Spool", active: true, pack: { baseUom: "EA", factors: { CS: 4 } }, listPrice: 89.5 },
  { id: "i2", sku: "THHN-12-RED-500", upc: "012345678912", mpn: "T12RD500", description: "THHN 12 AWG Stranded Copper Wire Red 500ft Spool", active: true, pack: { baseUom: "EA", factors: { CS: 4 } }, listPrice: 89.5 },
  { id: "i3", sku: "EMT-075-10", upc: "012345678929", mpn: "EMT34", description: '3/4" EMT Conduit 10ft', active: true, pack: { baseUom: "EA", factors: { BD: 100 }, multipleOf: 10 }, listPrice: 6.1 },
  { id: "i4", sku: "WN-YEL-100", upc: "012345678936", mpn: "30-074", description: "Yellow Wing Wire Connectors 100/Box", active: true, pack: { baseUom: "BX", factors: { CS: 10 } }, listPrice: 7.25 },
  { id: "i5", sku: "WN-RED-100", upc: "012345678943", mpn: "30-076", description: "Red Wing Wire Connectors 100/Box", active: true, pack: { baseUom: "BX", factors: { CS: 10 } }, listPrice: 7.25 },
  { id: "i6", sku: "BOX-4SQ-D", upc: "012345678950", mpn: "52171-K", description: '4" Square Box 2-1/8" Deep Steel', active: true, pack: { baseUom: "EA", factors: { CS: 50 } }, listPrice: 2.4 },
  { id: "i7", sku: "OLD-ITEM", upc: null, mpn: "OLD1", description: "Discontinued Widget", active: false, pack: { baseUom: "EA" }, listPrice: 1 },
  { id: "i8", sku: "GFCI-20-WH", upc: "012345678967", mpn: "GFNT2-W", description: "20A GFCI Receptacle White Tamper Resistant", active: true, pack: { baseUom: "EA", factors: { BX: 10 } }, listPrice: 18.9 },
];

export const CUSTOMERS: CustomerRecord[] = [
  { id: "c1", name: "Acme Electric Contractors", domains: ["acmeelectric.com"], accountNumber: "AC-1001", active: true },
  { id: "c2", name: "Bright Lights Inc", domains: ["brightlights.com"], accountNumber: "BL-2002", active: true, aka: ["Bright Lights Incorporated"] },
  { id: "c3", name: "Bright Lights Inc - Dallas Branch", domains: ["brightlights.com"], accountNumber: "BL-2003", active: true },
  { id: "c4", name: "Closed Co", domains: ["closed.com"], active: false },
];
