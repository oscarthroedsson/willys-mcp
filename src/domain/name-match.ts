/**
 * Match a search term against a product name the way Swedish groceries are
 * actually named.
 *
 * The old check was `name.includes(term)`, plain substring. That let "smör"
 * match "Smörgåsmargarin" and "torkad" match a dog chew — and separately let a
 * whole-word check be too strict, since Swedish puts the head noun last:
 * "vispgrädde" IS grädde, "körsbärstomat" IS tomat.
 *
 * The rule here: a term matches when some word in the name equals it or ENDS
 * with it. So "grädde" matches "vispgrädde" (head noun) but "smör" does not
 * match "smörgåsmargarin" (that word ends in margarin, not smör), and "tomat"
 * does not match "tomatsås" (ends in sås). It catches the head-noun-last
 * compounds while excluding modifier-position coincidences.
 */

const WORD_SPLIT = /[^a-zA-Z0-9åäöÅÄÖéèü]+/;

function words(name: string): string[] {
  return name.toLowerCase().split(WORD_SPLIT).filter(Boolean);
}

/** True when a word in `name` equals or ends with `term`. */
export function nameContainsTerm(name: string, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return false;
  return words(name).some((w) => w === t || w.endsWith(t));
}

/** True when `name` contains `term` anywhere (substring) — for exclusions. */
export function nameHasSubstring(name: string, term: string): boolean {
  const t = term.trim().toLowerCase();
  return t.length > 0 && name.toLowerCase().includes(t);
}

/**
 * Does the product plausibly answer the query?
 *
 * Uses the query's head noun (its last word) and asks whether the name equals
 * or ends with it. "potatis" against "Lök Gul" is false — the signal that the
 * cheapest match is the wrong thing entirely, so the caller can flag it instead
 * of shipping two kilos of onions labelled as potatoes.
 */
export function matchesQuery(name: string, query: string): boolean {
  const qWords = words(query);
  if (qWords.length === 0) return true; // no query to judge against
  const head = qWords[qWords.length - 1]!;

  return words(name).some(
    (w) =>
      w === head ||
      w.endsWith(head) ||
      // Willys abbreviates: "Visp" for vispgrädde, "Filé" for kycklingfilé.
      // Accept a product word that the query head begins with.
      (w.length >= 4 && head.startsWith(w)),
  );
}
