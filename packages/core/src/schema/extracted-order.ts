import { z } from "zod";
import { Confidence, DateField, NumberField, StringField } from "./common.js";

/**
 * The contract between the LLM extractor and everything downstream.
 * This is exactly what the model must return (structured output), so keep it
 * JSON-schema friendly: objects, arrays, enums, nullable scalars. No refinements.
 */

export const DocumentType = z.enum([
  "order",
  "quote_request",
  "status_inquiry",
  "remittance",
  "acknowledgment",
  "spam",
  "other",
]);
export type DocumentType = z.infer<typeof DocumentType>;

export const ExtractedAddress = z.object({
  name: StringField,
  attention: StringField,
  line1: StringField,
  line2: StringField,
  city: StringField,
  region: StringField.describe("State/province"),
  postalCode: StringField,
  country: StringField,
});
export type ExtractedAddress = z.infer<typeof ExtractedAddress>;

export const ExtractedLine = z.object({
  lineNo: z.number().int().describe("1-based line index in the order as written"),
  customerLineRef: StringField.describe("Customer's own line number/ref if printed"),
  rawPartNumber: StringField.describe(
    "Part number exactly as written, including customer or vendor prefixes",
  ),
  rawDescription: StringField.describe("Item description exactly as written"),
  quantity: NumberField,
  rawUom: StringField.describe("Unit of measure as written: EA, CS, BX, PK, FT..."),
  unitPrice: NumberField,
  extendedPrice: NumberField,
  requestedDate: DateField,
  notes: StringField.describe("Line-level remark such as substitutions or 'same as last time'"),
});
export type ExtractedLine = z.infer<typeof ExtractedLine>;

export const ExtractedParty = z.object({
  name: StringField,
  accountNumber: StringField.describe("Customer account/vendor number for the recipient if printed"),
  contactName: StringField,
  email: StringField,
  phone: StringField,
});
export type ExtractedParty = z.infer<typeof ExtractedParty>;

export const ExtractedOrder = z.object({
  poNumber: StringField,
  orderDate: DateField,
  requestedShipDate: DateField,
  customer: ExtractedParty.describe("The buyer sending the order"),
  billTo: ExtractedAddress,
  shipTo: ExtractedAddress,
  paymentTerms: StringField,
  shippingMethod: StringField,
  currency: StringField.describe("ISO 4217 code if determinable"),
  subtotal: NumberField,
  tax: NumberField,
  freight: NumberField,
  total: NumberField,
  specialInstructions: StringField,
  lines: z.array(ExtractedLine),
  pageRange: z
    .object({ from: z.number().int(), to: z.number().int() })
    .nullable()
    .describe("Pages this order occupies when a document holds several orders"),
});
export type ExtractedOrder = z.infer<typeof ExtractedOrder>;

/** Top-level extractor output: a document may hold zero or many orders. */
export const ExtractionOutput = z.object({
  documentType: DocumentType,
  documentTypeConfidence: Confidence,
  language: z.string().nullable().describe("BCP-47 language tag of the document, e.g. en"),
  orders: z.array(ExtractedOrder),
  warnings: z
    .array(z.string())
    .describe("Anything a human should know: illegible areas, totals that do not add up, cancellations"),
});
export type ExtractionOutput = z.infer<typeof ExtractionOutput>;
