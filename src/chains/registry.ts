import { hemkop, willys } from "./axfood.js";
import { coopAdapter } from "./coop.js";
import type { Capability, ChainAdapter, ChainId } from "./types.js";

/**
 * ChainId → adapter. The one place a new chain is wired in.
 *
 * City Gross and Mathem join here as their adapters land (epic 4).
 */
const ADAPTERS: Partial<Record<ChainId, ChainAdapter>> = {
  willys,
  hemkop,
  coop: coopAdapter,
};

export function getAdapter(chain: ChainId): ChainAdapter | null {
  return ADAPTERS[chain] ?? null;
}

/** Every wired adapter, in a stable order. */
export function allAdapters(): ChainAdapter[] {
  return Object.values(ADAPTERS).filter((a): a is ChainAdapter => Boolean(a));
}

/** Which chains can do this — for error text that offers an alternative. */
export function chainsWith(cap: Capability): ChainAdapter[] {
  return allAdapters().filter((a) => a.capabilities.has(cap));
}
