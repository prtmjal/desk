/**
 * pg_trgm-compatible trigram similarity in pure TypeScript.
 * Used by the in-memory catalog (CLI, tests). Production L2 runs the same
 * algorithm inside Postgres via pg_trgm so results agree.
 *
 * pg_trgm rules: lowercase, split into words on non-alphanumerics, pad each
 * word with two leading spaces and one trailing space, take all 3-grams.
 * similarity = |A ∩ B| / |A ∪ B|.
 */
export function trigrams(text: string): Set<string> {
  const out = new Set<string>();
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const w of words) {
    const padded = `  ${w} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

export function similarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * word_similarity analogue: how much of `needle` is covered by `haystack`.
 * Useful when the PO description is short and the catalog description is long.
 */
export function coverage(needle: string, haystack: string): number {
  const tn = trigrams(needle);
  if (tn.size === 0) return 0;
  const th = trigrams(haystack);
  let inter = 0;
  for (const t of tn) if (th.has(t)) inter++;
  return inter / tn.size;
}
