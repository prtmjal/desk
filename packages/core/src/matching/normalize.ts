/**
 * Deterministic text normalization used by L0 (exact) and L2 (trigram) layers.
 * Pure functions, no I/O. Changing these changes match behaviour: run `pnpm evals`.
 */

/** Collapse a part number to a comparable key: uppercase, alphanumerics only. */
export function normalizePartNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .trim();
  return key.length === 0 ? null : key;
}

/**
 * Strip common prefixes/suffixes customers add to part numbers:
 * "P/N", "PN:", "ITEM#", "SKU", "MFG#", trailing pack markers like "-CS" "/EA" "x12".
 * Returns a list of variants (most specific first) so L0 can try each.
 */
export function partNumberVariants(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const variants = new Set<string>();
  const base = raw.trim();
  variants.add(base);

  const stripped = base
    .replace(/^(p\/?n|pn|part\s*(no|number|#)?|item\s*(no|number|#)?|sku|mfg\s*#?|mpn|cat\s*#?|catalog\s*#?)[:#\s.-]*/i, "")
    .trim();
  if (stripped) variants.add(stripped);

  // Drop trailing pack / uom markers: ABC-123-CS, ABC-123/EA, ABC-123 x12, ABC-123 (12/CS)
  const noPack = stripped
    .replace(/\s*\(.*?\)\s*$/, "")
    .replace(/[\s\-\/]+(ea|cs|bx|pk|pr|dz|ct|rl|bg|pl|pc|pcs|each|case|box|pack)$/i, "")
    .replace(/\s*[x×]\s*\d+$/i, "")
    .trim();
  if (noPack) variants.add(noPack);

  // Remove leading zeros segments like 0001234 -> 1234 (common in ERP exports)
  const noLeadingZeros = noPack.replace(/^0+(?=\d)/, "");
  if (noLeadingZeros) variants.add(noLeadingZeros);

  return [...variants]
    .map((v) => normalizePartNumber(v))
    .filter((v): v is string => !!v)
    .filter((v, i, arr) => arr.indexOf(v) === i);
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "of", "a", "an", "to", "in", "on", "per", "each", "ea", "pcs",
  "pc", "qty", "item", "part", "no", "pkg", "pack", "case", "box",
]);

/** Lowercase word tokens from a description, stopwords removed, numbers kept. */
export function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/["'`]/g, "")
    .split(/[^a-z0-9.\/]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

/** Canonical description string for trigram comparison. */
export function normalizeDescription(text: string | null | undefined): string {
  return tokenize(text).join(" ");
}

/** Normalize common dimension/fraction spellings: 1/2" -> 1/2in, 3-1/2 -> 3.5 */
export function normalizeDimensions(text: string): string {
  return text
    .replace(/(\d+)\s*-\s*(\d+)\/(\d+)/g, (_m, w, n, d) => String(Number(w) + Number(n) / Number(d)))
    .replace(/(\d+)\/(\d+)\s*(?:"|in\b|inch(?:es)?\b)/gi, (_m, n, d) => `${Number(n) / Number(d)}in`)
    .replace(/(\d+(?:\.\d+)?)\s*(?:"|inch(?:es)?\b)/gi, "$1in")
    .replace(/(\d+(?:\.\d+)?)\s*(?:'|ft\b|feet\b|foot\b)/gi, "$1ft");
}
