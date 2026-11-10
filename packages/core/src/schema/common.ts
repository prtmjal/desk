import { z } from "zod";

/** 0..1 confidence. Every extracted value carries one (plan §6.6). */
export const Confidence = z.number().describe("Confidence 0..1");

/**
 * Where a value came from in the source document, so the UI can highlight it.
 * Kept loose on purpose: the LLM supplies page + quoted text; OCR may add bbox later.
 */
export const Provenance = z.object({
  page: z.number().int().nullable().describe("1-based page number in the source document, or null"),
  quote: z
    .string()
    .nullable()
    .describe("Short verbatim text from the document that supports the value (<= 120 chars)"),
});
export type Provenance = z.infer<typeof Provenance>;

/** A field value with confidence and provenance. `value` is null when absent. */
export function field<T extends z.ZodTypeAny>(valueSchema: T, description?: string) {
  return z.object({
    value: valueSchema.nullable().describe(description ?? "The extracted value, or null if absent"),
    confidence: Confidence,
    provenance: Provenance.nullable(),
  });
}

export const StringField = field(z.string());
export const NumberField = field(z.number());
export const DateField = field(z.string().describe("ISO-8601 date YYYY-MM-DD"));

export type StringField = z.infer<typeof StringField>;
export type NumberField = z.infer<typeof NumberField>;
export type DateField = z.infer<typeof DateField>;

export function emptyField<T>(): { value: T | null; confidence: number; provenance: null } {
  return { value: null, confidence: 0, provenance: null };
}

export function withValue<T>(
  value: T,
  confidence = 1,
  provenance: Provenance | null = null,
): { value: T; confidence: number; provenance: Provenance | null } {
  return { value, confidence, provenance };
}
