import { hemkop, willys } from "./axfood.js";
import { citygrossAdapter } from "./citygross.js";
import { coopAdapter } from "./coop.js";
import { mathemAdapter } from "./mathem.js";
import type { Capability, ChainAdapter, ChainId } from "./types.js";

/**
 * ChainId → adapter. The one place a new chain is wired in.
 *
 * ICA is deliberately absent: its API sits behind AWS WAF allowing about five
 * calls per five minutes, too few to plan a basket (docs/kedjor.md).
 */
const ADAPTERS: Record<ChainId, ChainAdapter> = {
  willys,
  hemkop,
  coop: coopAdapter,
  citygross: citygrossAdapter,
  mathem: mathemAdapter,
};

export function getAdapter(chain: ChainId): ChainAdapter {
  return ADAPTERS[chain];
}

/** Every wired adapter, in a stable order. */
export function allAdapters(): ChainAdapter[] {
  return Object.values(ADAPTERS);
}

/** Which chains can do this — for error text that offers an alternative. */
export function chainsWith(cap: Capability): ChainAdapter[] {
  return allAdapters().filter((a) => a.capabilities.has(cap));
}
