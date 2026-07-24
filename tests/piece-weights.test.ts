import { pieceWeight } from "../src/domain/piece-weights.js";

/** Piece-weight lookup, no network. */

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  console.log(a === e ? `  ok    ${label}` : `  FEL   ${label}  väntat ${e} fick ${a}`);
  if (a !== e) process.exitCode = 1;
}

console.log("=== styckvikter ===");
check("gul lök", pieceWeight("gul lök"), 90);
check("rödlök", pieceWeight("rödlök"), 90);
check("tomat", pieceWeight("tomat"), 110);
check("gurka", pieceWeight("gurka"), 350);
check("tail match: färsk gul lök -> lök", pieceWeight("färsk gul lök"), 90);
check("alias: isberg -> isbergssallad", pieceWeight("isberg"), 400);
check("okänd: vitlök (medvetet uteslutet)", pieceWeight("vitlök"), null);
check("okänd: kryddpeppar", pieceWeight("kryddpeppar"), null);

console.log(process.exitCode ? "\nRÖD" : "\nGRÖN");
