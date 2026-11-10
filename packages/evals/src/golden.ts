import { z } from "zod";
import { ExtractionOutput } from "@desk/core";

/**
 * Golden-set format (plan §6.6, §7.6). One JSON file per labeled document:
 *   golden/<set>/<case-id>.json  → GoldenCase
 *   golden/<set>/catalog.json    → { items, customers } used for matching in that set
 * `input` points at the source document(s) relative to the case file, or carries inline text.
 * `expected.extraction` is the labeled ExtractionOutput; `expected.matches` maps lineNo → item id or null.
 */
export const GoldenInput = z.object({
  sender: z.string().nullable().default(null),
  subject: z.string().nullable().default(null),
  bodyText: z.string().nullable().default(null),
  /** Attachment file names relative to the case file */
  attachments: z.array(z.string()).default([]),
});

export const GoldenCase = z.object({
  id: z.string(),
  /** clean_pdf | scanned | excel | email_body | handwritten | adversarial */
  kind: z.string(),
  tenant: z.string().default("demo"),
  tags: z.array(z.string()).default([]),
  input: GoldenInput,
  expected: z.object({
    extraction: ExtractionOutput,
    /** lineNo → catalog item id ("" when the correct answer is to abstain) */
    matches: z.record(z.string(), z.string().nullable()).default({}),
    customerId: z.string().nullable().default(null),
    /** Whether a correct system should auto-post this (false-auto-post rate must be ~0) */
    safeToAutoPost: z.boolean().default(false),
  }),
  /** Optional cached model output so the eval can run offline/deterministically */
  cached: z
    .object({
      extraction: ExtractionOutput,
      model: z.string(),
      promptVersion: z.string(),
      recordedAt: z.string(),
    })
    .nullable()
    .default(null),
});
export type GoldenCase = z.infer<typeof GoldenCase>;
