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
 * A loose relevance check for cheapest-first without an explicit mustContain.
 *
 * Willys search on "mineralvatten naturell" cheapest-first returned tampons and
 * herbal tea — nothing shared a word, yet nothing filtered them. This keeps a
 * product only when some substantial query word (≥4 chars) overlaps a product
 * word either way, so "vatten" still matches "mineralvatten" and "Visp" still
 * matches "vispgrädde", while unrelated junk is dropped. Short queries (no word
 * ≥4) are not judged — the filter stays out of the way rather than over-cutting.
 */
export function looselyRelates(name: string, query: string): boolean {
  const qWords = words(query).filter((w) => w.length >= 4);
  if (qWords.length === 0) return true;
  const nWords = words(name).filter((w) => w.length >= 4);
  return qWords.some((q) =>
    nWords.some((n) => n.includes(q) || q.includes(n) || sameHead(q, n)),
  );
}

/** Extra letters after the query that make it a modifier, not the product. */
const MIN_HEAD_SUFFIX = 3;

/**
 * The query appears only as the first part of a compound whose head is
 * something else: "Köttfärssås" for "köttfärs" (a sauce), "Äggnudlar" for
 * "ägg" (noodles), "Kaffefilter" for "kaffe". Swedish puts the head noun last,
 * so these are different products that merely contain the word — the same
 * principle by which mustContain "tomat" rejects "tomatsås". Cheapest-first
 * would otherwise rank them above the real thing: köttfärssås at 51 kr/kg beat
 * every mince at Willys, and äggnudlar pushed every egg out of the top twelve
 * at City Gross and Mathem.
 */
export function onlyAsModifier(name: string, query: string): boolean {
  const q = words(query);
  const head = q[q.length - 1];
  if (!head || head.length < 3) return false;
  const ws = words(name);
  const proper = ws.some((w) => w === head || w.endsWith(head) || sameHead(w, head));
  if (proper) return false;
  return ws.some((w) => w.startsWith(head) && w.length - head.length >= MIN_HEAD_SUFFIX);
}

/** Shortest shared ending that counts as a shared head noun. */
const MIN_HEAD = 4;

/**
 * Two compounds with the same head noun: "köttfärs" and "nötfärs" both end in
 * "färs". Swedish puts the head last, so a shared ending of a whole morpheme is
 * the same kind of thing — without it, cheapest "köttfärs" threw away Nötfärs,
 * Blandfärs and Fläskfärs (35 of 37 hits at Willys, 17 of 17 at Coop) and
 * kept only a pie. Loose on purpose: this guards against junk ("tamponger" for
 * "mineralvatten"), not against near-misses, which category and mustContain
 * handle.
 */
export function sameHead(a: string, b: string): boolean {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i >= MIN_HEAD;
}

/**
 * Pet food, recognised by category when the chain states one and by name
 * otherwise. "köttfärs" at Coop ranked cat food first (40,79 kr/kg) — it is the
 * cheapest meat-containing thing, and the wrong one.
 */
const PET_CATEGORY = /djur|husdjur/i;
const PET_WORDS = new Set([
  "katt", "hund", "valp", "kattunge", "kattmat", "hundmat", "djurmat",
  "foder", "kattsand", "fågelfrö", "hundben",
]);
const PET_PREFIX = /^(katt|hund|valp)/;
const PET_SUFFIX = /(mat|godis|snacks?|ben|foder|tugg\w*|bitar)$/;
const PET_QUERY = /katt|hund|valp|djur|foder|fågelfrö|husdjur/i;

/** True when the product is pet food and the query is not about pets. */
export function isUnwantedPetFood(
  p: { name: string; category?: string | null | undefined },
  query: string,
): boolean {
  if (PET_QUERY.test(query)) return false;
  if (p.category && PET_CATEGORY.test(p.category)) return true;
  // Word-based, not \b-regex: JavaScript's \b treats å, ä and ö as non-letters.
  return words(p.name).some(
    (w) => PET_WORDS.has(w) || (PET_PREFIX.test(w) && PET_SUFFIX.test(w)) || w.startsWith("hundtugg"),
  );
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
