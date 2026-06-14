/**
 * Offline NLP primitives used by the evaluation engine.
 *
 * These deliberately avoid any external embedding/LLM API so that evaluation is
 * deterministic, key-free, and safe to run inside CI. The public surface mirrors
 * what a real embedding backend would expose, so it can be swapped later.
 */

/** A sparse term-frequency vector keyed by token. */
export type TermVector = Map<string, number>;

/**
 * Common English stop-words removed before similarity scoring so that overlap
 * is driven by content words rather than filler.
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have',
  'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'to', 'was',
  'were', 'will', 'with', 'this', 'these', 'those', 'their', 'they', 'them',
  'do', 'does', 'did', 'but', 'if', 'then', 'than', 'so', 'such', 'about',
  // Interrogatives — they carry little topical signal and otherwise depress
  // query↔answer relevance scores (queries are questions, answers are not).
  'what', 'who', 'whom', 'whose', 'when', 'where', 'which', 'why', 'how',
]);

/**
 * Splits text into normalized content tokens (lower-cased, punctuation removed,
 * stop-words dropped).
 *
 * @param text - Raw input text.
 * @returns Array of content tokens (may be empty).
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const matches = text.toLowerCase().match(/[a-z0-9]+/g);
  if (!matches) return [];
  return matches.filter((token) => !STOP_WORDS.has(token));
}

/**
 * Builds a term-frequency vector from raw text.
 *
 * @param text - Raw input text.
 * @returns A {@link TermVector} of token → count.
 */
export function termFrequency(text: string): TermVector {
  const vector: TermVector = new Map();
  for (const token of tokenize(text)) {
    vector.set(token, (vector.get(token) ?? 0) + 1);
  }
  return vector;
}

/**
 * Computes the L2 norm (magnitude) of a term vector.
 *
 * @param vector - The term vector.
 * @returns The Euclidean magnitude.
 */
function magnitude(vector: TermVector): number {
  let sum = 0;
  for (const value of vector.values()) {
    sum += value * value;
  }
  return Math.sqrt(sum);
}

/**
 * Cosine similarity between two term-frequency vectors.
 *
 * @param a - First vector.
 * @param b - Second vector.
 * @returns Similarity in the range [0, 1] (0 when either vector is empty).
 */
export function cosineSimilarity(a: TermVector, b: TermVector): number {
  if (a.size === 0 || b.size === 0) return 0;

  // Iterate the smaller map for the dot product.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [token, value] of small) {
    const other = large.get(token);
    if (other !== undefined) {
      dot += value * other;
    }
  }

  const denom = magnitude(a) * magnitude(b);
  if (denom === 0) return 0;

  const score = dot / denom;
  // Guard against tiny floating-point excursions outside [0, 1].
  return Math.max(0, Math.min(1, score));
}

/**
 * Convenience helper: cosine similarity directly between two raw strings.
 *
 * @param a - First string.
 * @param b - Second string.
 * @returns Similarity in [0, 1].
 */
export function textSimilarity(a: string, b: string): number {
  return cosineSimilarity(termFrequency(a), termFrequency(b));
}

/**
 * Splits a block of text into trimmed, non-empty sentences.
 *
 * @param text - Raw input text.
 * @returns Array of sentence strings (falls back to the whole text if no
 *          sentence delimiters are present).
 */
export function splitSentences(text: string): string[] {
  if (!text || !text.trim()) return [];
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : [text.trim()];
}
