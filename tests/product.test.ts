
// --- P1.2: package price for loose kr/kg goods (regression) ---
import { toProduct } from "../src/domain/product.js";

function checkP(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  console.log(a === e ? `  ok    ${label}` : `  FEL   ${label}  väntat ${e} fick ${a}`);
  if (a !== e) process.exitCode = 1;
}

console.log("\n=== P1.2 package price ===");
{
  // Paprika Grön: 39.90 kr/kg, ca:200g -> package ~7.98 kr, not 39.90.
  const p = toProduct({ code:"100149224_KG", name:"Paprika Grön Klass 1",
    priceValue:39.9, priceUnit:"kr/kg", comparePriceUnit:"kg", displayVolume:"ca: 200g" } as never);
  checkP("kr/kg paprika -> package price ~7.98", p.packagePrice, 7.98);
  checkP("raw price preserved", p.price, 39.9);
}
{
  // Per-package _ST item: priceValue IS the package price.
  const p = toProduct({ code:"101519201_ST", name:"Grönsaker Fryst",
    priceValue:22.9, priceUnit:"kr/st", comparePriceUnit:"kg", displayVolume:"600g" } as never);
  checkP("kr/st frozen veg -> package price unchanged", p.packagePrice, 22.9);
}
{
  // Milk 1 l priced per litre.
  const p = toProduct({ code:"100_KG", name:"Mjölk",
    priceValue:14.9, priceUnit:"kr/l", comparePriceUnit:"l", displayVolume:"1l" } as never);
  checkP("kr/l milk 1l -> 14.90", p.packagePrice, 14.9);
}
{
  // Count-sold item (st): no weight conversion.
  const p = toProduct({ code:"200_ST", name:"Vitlökspress",
    priceValue:29.9, priceUnit:"kr/st", comparePriceUnit:"st", displayVolume:"st" } as never);
  checkP("kr/st press -> 29.90", p.packagePrice, 29.9);
}
console.log(process.exitCode ? "\nP1.2 RÖD" : "\nP1.2 GRÖN");
