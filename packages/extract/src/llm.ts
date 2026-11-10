import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ExtractionOutput, DocumentType, type CostRecord, type CatalogItem, type ExtractedLine } from "@desk/core";
import { getAnthropic, modelConfigFromEnv, usageToCost, type ModelConfig } from "./client.js";
import { loadPrompt } from "./prompts/index.js";
import type { NormalizedDocument } from "./normalize/types.js";
import { documentToContentBlocks } from "./normalize/to-content.js";

export const ClassificationOutput = z.object({
  documentType: DocumentType,
  confidence: z.number(),
  hasAttachments: z.boolean(),
  estimatedOrderCount: z.number().int().nullable(),
  rationale: z.string(),
});
export type ClassificationOutput = z.infer<typeof ClassificationOutput>;

export const RerankOutput = z.object({
  itemId: z.string().nullable(),
  confidence: z.number(),
  reason: z.string(),
});
export type RerankOutput = z.infer<typeof RerankOutput>;

export type LlmResult<T> = { output: T; cost: CostRecord; model: string; promptVersion: string; stopReason: string | null };

/**
 * The pipeline depends on this interface, not on the Anthropic client, so the
 * whole pipeline is unit-testable with a fake and replayable from stored outputs.
 */
export interface LlmClient {
  classify(doc: NormalizedDocument): Promise<LlmResult<ClassificationOutput>>;
  extract(doc: NormalizedDocument): Promise<LlmResult<ExtractionOutput>>;
  rerank(input: { line: ExtractedLine; documentContext: string | null; candidates: CatalogItem[] }): Promise<LlmResult<RerankOutput>>;
}

export class AnthropicLlm implements LlmClient {
  private client: Anthropic;
  private models: ModelConfig;

  constructor(opts: { client?: Anthropic; models?: ModelConfig } = {}) {
    this.client = opts.client ?? getAnthropic();
    this.models = opts.models ?? modelConfigFromEnv();
  }

  async classify(doc: NormalizedDocument): Promise<LlmResult<ClassificationOutput>> {
    const prompt = loadPrompt("classify");
    const model = this.models.classify;
    const blocks = documentToContentBlocks(doc, { firstPageOnly: true, maxTextChars: 6000 });
    const res = await this.client.messages.parse({
      model,
      max_tokens: 1024,
      output_config: { effort: "low", format: zodOutputFormat(ClassificationOutput) },
      system: [{ type: "text", text: prompt.body, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: blocks }],
    });
    return finish(res, model, prompt.version);
  }

  async extract(doc: NormalizedDocument): Promise<LlmResult<ExtractionOutput>> {
    const prompt = loadPrompt("extract-order");
    const model = this.models.extract;
    const blocks = documentToContentBlocks(doc, {});
    // Streaming keeps long multi-order extractions clear of HTTP timeouts.
    const stream = this.client.messages.stream({
      model,
      max_tokens: 32000,
      output_config: { effort: "medium", format: zodOutputFormat(ExtractionOutput) },
      system: [{ type: "text", text: prompt.body, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: blocks }],
    });
    const res = await stream.finalMessage();
    const parsed = parseStructured(res, ExtractionOutput);
    return { output: parsed, cost: usageToCost(res.usage, model), model, promptVersion: prompt.version, stopReason: res.stop_reason };
  }

  async rerank(input: { line: ExtractedLine; documentContext: string | null; candidates: CatalogItem[] }): Promise<LlmResult<RerankOutput>> {
    const prompt = loadPrompt("rerank");
    const model = this.models.rerank;
    const line = input.line;
    const userText = [
      "PO line:",
      `  part number: ${line.rawPartNumber.value ?? "(none)"}`,
      `  description: ${line.rawDescription.value ?? "(none)"}`,
      `  quantity: ${line.quantity.value ?? "?"} ${line.rawUom.value ?? ""}`,
      `  unit price: ${line.unitPrice.value ?? "(none)"}`,
      `  notes: ${line.notes.value ?? "(none)"}`,
      input.documentContext ? `\nDocument context:\n${input.documentContext}` : "",
      "\nCandidates:",
      ...input.candidates.map(
        (c) =>
          `  - itemId=${c.id} sku=${c.sku} mpn=${c.mpn ?? "-"} upc=${c.upc ?? "-"} uom=${c.pack.baseUom} price=${c.listPrice ?? "-"} :: ${c.description}${c.extra ? ` (${c.extra})` : ""}`,
      ),
    ].join("\n");
    const res = await this.client.messages.parse({
      model,
      max_tokens: 1024,
      output_config: { effort: "low", format: zodOutputFormat(RerankOutput) },
      system: [{ type: "text", text: prompt.body, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userText }],
    });
    const out = finish(res, model, prompt.version);
    // Guard against an itemId that is not in the candidate list.
    if (out.output.itemId && !input.candidates.some((c) => c.id === out.output.itemId)) {
      out.output = { itemId: null, confidence: 0, reason: `Model returned unknown itemId ${out.output.itemId}` };
    }
    return out;
  }
}

type Parsed<T> = Anthropic.Message & { parsed_output: T | null };

function finish<T>(res: Parsed<T>, model: string, promptVersion: string): LlmResult<T> {
  if (res.stop_reason === "refusal") {
    throw new Error(`Model refused: ${res.stop_details?.explanation ?? "no explanation"}`);
  }
  if (res.parsed_output === null || res.parsed_output === undefined) {
    throw new Error(`Structured output could not be parsed (stop_reason=${res.stop_reason})`);
  }
  return { output: res.parsed_output, cost: usageToCost(res.usage, model), model, promptVersion, stopReason: res.stop_reason };
}

function parseStructured<T extends z.ZodTypeAny>(res: Anthropic.Message, schema: T): z.infer<T> {
  if (res.stop_reason === "refusal") {
    throw new Error(`Model refused: ${res.stop_details?.explanation ?? "no explanation"}`);
  }
  if (res.stop_reason === "max_tokens") {
    throw new Error("Extraction output truncated at max_tokens; split the document or raise the limit");
  }
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return schema.parse(JSON.parse(text));
}
