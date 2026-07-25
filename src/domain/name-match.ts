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
/**
 * Attribute groups where a mismatch means the wrong product.
 *
 * The head-noun check passes "grön paprika" against "Paprika Gul" — the noun is
 * right, the colour is wrong, and cheapest-first happily picks it. These groups
 * make a differing attribute a hard signal: if the query names one value and the
 * product names a DIFFERENT value from the same group, it is the wrong thing.
 */
const ATTRIBUTE_GROUPS: string[][] = [
  ["grön", "gul", "röd", "orange", "vit", "svart", "brun", "lila"],
  ["hel", "hackad", "riven", "skivad", "strimlad", "krossad", "mald", "malen"],
  ["färsk", "fryst", "fryst", "torkad", "inlagd", "picklad", "rökt", "konserverad"],
  [
    "naturell", "osötad", "sötad", "smaksatt",
    "citron", "lime", "apelsin", "hallon", "jordgubb", "passion", "ananas",
    "mango", "päron", "äpple", "kokos", "vanilj", "choklad", "mynta",
  ],
];

/**
 * Does the product name carry an attribute that contradicts the query?
 *
 * True when the query names a value from an attribute group and the product
 * names a different value from that same group — "grön" vs "gul", "naturell" vs
 * "passion". Independent of price and of surplus settings, so the cheapest
 * route cannot launder a wrong colour or flavour past review.
 */
export function attributeConflict(name: string, query: string): boolean {
  const q = new Set(words(query));
  const n = new Set(words(name));
  for (const group of ATTRIBUTE_GROUPS) {
    const wanted = group.filter((a) => q.has(a));
    if (wanted.length === 0) continue;
    const present = group.filter((a) => n.has(a));
    // The product states a value from this group, and none of them is wanted.
    if (present.length > 0 && !present.some((a) => wanted.includes(a))) {
      return true;
    }
  }
  return false;
}

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
