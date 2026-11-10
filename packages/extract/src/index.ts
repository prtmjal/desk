/**
 * @desk/extract — document normalization, prompts, model clients, pipeline.
 * The only package that talks to the Anthropic API.
 */
export * from "./client";
export * from "./llm";
export * from "./normalize/index";
export * from "./pipeline";
export { loadPrompt, renderPrompt, parseFrontMatter, type LoadedPrompt, type PromptName } from "./prompts/index";
export { FakeLlm } from "./testing/fake-llm";
export * as fixtures from "./testing/fixtures";
export { HeuristicLlm } from "./testing/heuristic-llm";
