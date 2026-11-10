import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Prompts are versioned markdown files (plan §7.3 #4): `name.vN.md`.
 * Front matter (first lines) carries `version:` and `model-notes:`; the body is the prompt.
 * Bump the version and add a CHANGELOG entry on any change; `pnpm evals` gates the merge.
 */
export type PromptName = "extract-order" | "classify" | "rerank";

export type LoadedPrompt = { name: PromptName; version: string; body: string };

/**
 * Prompt files sit next to this module. When the package is bundled (Next.js), the module
 * path no longer points at the source tree, so the host sets DESK_PROMPTS_DIR instead.
 */
const promptsDir = () => process.env.DESK_PROMPTS_DIR || dirname(fileURLToPath(import.meta.url));

const PINNED: Record<PromptName, number> = {
  "extract-order": 1,
  classify: 1,
  rerank: 1,
};

const cache = new Map<string, LoadedPrompt>();

export function loadPrompt(name: PromptName, version: number = PINNED[name]): LoadedPrompt {
  const key = `${name}.v${version}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const raw = readFileSync(join(promptsDir(), `${key}.md`), "utf8");
  const parsed = parseFrontMatter(raw);
  const loaded: LoadedPrompt = { name, version: parsed.meta.version ?? `v${version}`, body: parsed.body.trim() };
  cache.set(key, loaded);
  return loaded;
}

export function parseFrontMatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, body: m[2]! };
}

/** Simple `{{name}}` substitution; missing variables throw so prompts never ship with holes. */
export function renderPrompt(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key];
    if (v === undefined) throw new Error(`Prompt variable missing: ${key}`);
    return v;
  });
}
