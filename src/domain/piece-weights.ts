/**
 * Typical weight of one piece of common fresh produce, in grams.
 *
 * Recipes count in pieces ("2 gul lök", "1 gurka") but Willys sells this produce
 * loose by weight ("ca: 160g"), so a count requirement can never be covered by a
 * weight-priced product — the measures disagree and every candidate is rejected.
 * These averages let a count requirement be converted to a mass one so the match
 * can happen.
 *
 * Deliberately conservative. Only items whose single-piece weight is reasonably
 * stable are listed. Anything ambiguous (vitlök — a bulb or a clove? ingefära,
 * kryddor) is left out on purpose: returning "needs a weight" beats a confident
 * wrong conversion.
 *
 * Keyed by the normalised search term. Grams.
 */
const WEIGHTS: Record<string, number> = {
  tomat: 110,
  gurka: 350,
  lök: 90,
  "gul lök": 90,
  rödlök: 90,
  "röd lök": 90,
  purjolök: 200,
  salladslök: 15,
  paprika: 150,
  morot: 65,
  potatis: 100,
  citron: 100,
  lime: 70,
  apelsin: 200,
  äpple: 180,
  banan: 120,
  avokado: 170,
  zucchini: 200,
  aubergine: 250,
  fänkål: 250,
  broccoli: 350,
  blomkål: 600,
  isbergssallad: 400,
  salladshuvud: 400,
  vitkål: 1000,
  mango: 350,
};

/** A few ways recipes write the same item. */
const ALIASES: Record<string, string> = {
  "gullök": "lök",
  "gul-lök": "lök",
  "lök gul": "lök",
  "lök röd": "rödlök",
  "isberg": "isbergssallad",
  "isbergssallad klass 1": "isbergssallad",
};

function normalise(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Grams per piece for an ingredient, or null when unknown.
 *
 * Matches the whole normalised term, then an alias, then the last word — so
 * "färsk gul lök" still resolves via "lök".
 */
export function pieceWeight(query: string): number | null {
  const key = normalise(query);
  if (key in WEIGHTS) return WEIGHTS[key]!;
  if (key in ALIASES) return WEIGHTS[ALIASES[key]!]!;

  const words = key.split(" ");
  for (let i = 0; i < words.length; i++) {
    const tail = words.slice(i).join(" ");
    if (tail in WEIGHTS) return WEIGHTS[tail]!;
    if (tail in ALIASES) return WEIGHTS[ALIASES[tail]!]!;
  }
  const last = words[words.length - 1]!;
  return last in WEIGHTS ? WEIGHTS[last]! : null;
}
