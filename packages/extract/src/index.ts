/**
 * @desk/extract — document normalization, prompts, model clients, pipeline.
 * The only package that talks to the Anthropic API.
 */
export * from "./client.js";
export * from "./llm.js";
export * from "./normalize/index.js";
export * from "./pipeline.js";
export { loadPrompt, renderPrompt, parseFrontMatter, type LoadedPrompt, type PromptName } from "./prompts/index.js";
export { FakeLlm } from "./testing/fake-llm.js";
export * as fixtures from "./testing/fixtures.js";
