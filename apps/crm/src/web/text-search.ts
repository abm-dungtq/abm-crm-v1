/** Accent-insensitive text matching for Vietnamese names and titles. */

/** Folds Vietnamese diacritics using NFD normalization so typing `lan` or `dat` matches `Lân` or `Đạt`. */
export function foldDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase();
}

/**
 * True when every word of `query` appears somewhere in `text`, ignoring case and accents: "huy" matches
 * "Bùi Quang Huy", "quang bui" matches it too. A blank query matches everything.
 */
export function matchesSearch(text: string, query: string): boolean {
  const words = foldDiacritics(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = foldDiacritics(text);
  return words.every((w) => haystack.includes(w));
}
