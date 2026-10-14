import { axfoodEndpoints, type AxfoodSite } from "../../constants/index.js";
import { request } from "../../core/http.js";
import { ok, type Result } from "../../core/result.js";
import { parse } from "./parse.js";
import { UpstreamOrders } from "./schemas.js";

export type OrderStatus = "levererad" | "pagaende";

export interface OrderSummary {
  id: string;
  date: string;
  status: OrderStatus;
  total: number | null;
}

export interface OrderLine {
  name: string;
  code: string | null;
  quantity: string | null;
  category: string;
}

export interface FrequentProduct {
  name: string;
  code: string | null;
  timesBought: number;
  category: string;
}

/** Willys formats totals as "1 234,50"; normalise to a number. */
function toAmount(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const n = Number.parseFloat(value.replace(/\s/g, "").replace(",", "."));
  return Number.isNaN(n) ? null : n;
}

/** Orders carry the id under one of three keys depending on age. */
function orderId(raw: Record<string, unknown>): string {
  return String(raw.orderNumber ?? raw.code ?? raw.guid ?? "");
}

/**
 * Order history, paged in memory.
 *
 * The upstream route is unpaginated: 69 orders arrived as 45 KB in a single
 * response. Slicing here keeps the model's context from absorbing all of it.
 */
export async function getOrders(
  site: AxfoodSite,
  cookies: string,
  limit = 10,
  offset = 0,
): Promise<Result<{ orders: OrderSummary[]; total: number }>> {
  const res = await request(axfoodEndpoints(site).orders, {
    cookies,
    label: site.label,
  });
  if (!res.ok) return res;

  const parsed = parse(UpstreamOrders, res.data);
  if (!parsed.ok) return parsed;

  const all = parsed.data;
  const orders = all.slice(offset, offset + limit).map((o) => ({
    id: orderId(o as Record<string, unknown>),
    date: o.deliveryFormattedDate ?? o.formattedOrderDate ?? "",
    status: (o.complete || o.completed
      ? "levererad"
      : "pagaende") as OrderStatus,
    total: toAmount(o.total),
  }));

  return ok({ orders, total: all.length });
}

/** All line items in one past order, flattened out of their category buckets. */
export async function getOrderDetails(
  site: AxfoodSite,
  cookies: string,
  id: string,
): Promise<Result<{ id: string; lines: OrderLine[] }>> {
  const url = `${axfoodEndpoints(site).orderData}?q=${encodeURIComponent(id)}`;
  const res = await request<{
    categoryOrderedDeliveredProducts?: Record<string, unknown[]>;
  }>(url, { cookies, label: site.label });
  if (!res.ok) return res;

  const byCategory = res.data.categoryOrderedDeliveredProducts ?? {};
  const lines: OrderLine[] = [];

  for (const [category, items] of Object.entries(byCategory)) {
    for (const item of items ?? []) {
      const p = item as Record<string, unknown>;
      const name = typeof p.name === "string" ? p.name : null;
      if (!name) continue;
      lines.push({
        name,
        code: typeof p.code === "string" ? p.code : null,
        quantity:
          typeof p.displayQuantity === "string" ? p.displayQuantity : null,
        category,
      });
    }
  }

  return ok({ id, lines });
}

/**
 * "Mina vanligaste varor" derived from real order history.
 *
 * The CMS endpoint the previous implementation used (pageLabelOrId=
 * minavanligastevaror) returns a 22 KB page shell containing zero product
 * codes, so that tool never returned anything useful. Order history is both
 * accurate and personal: for "riven ost" you want the cheese this household
 * actually buys, not the semantically nearest one.
 *
 * Costs one request per scanned order, which is why `scanOrders` is capped.
 */
export async function getFrequentProducts(
  site: AxfoodSite,
  cookies: string,
  scanOrders: number,
  limit: number,
): Promise<Result<{ scanned: number; products: FrequentProduct[] }>> {
  const list = await request<Array<Record<string, unknown>>>(
    axfoodEndpoints(site).orders,
    { cookies, label: site.label },
  );
  if (!list.ok) return list;

  const ids = list.data.map(orderId).filter(Boolean).slice(0, scanOrders);
  const tally = new Map<string, FrequentProduct>();

  for (const id of ids) {
    const detail = await getOrderDetails(site, cookies, id);
    // One unreadable order should not sink the whole tally.
    if (!detail.ok) continue;

    for (const line of detail.data.lines) {
      const key = line.code ?? line.name;
      const existing = tally.get(key);
      if (existing) {
        existing.timesBought += 1;
      } else {
        tally.set(key, {
          name: line.name,
          code: line.code,
          timesBought: 1,
          category: line.category,
        });
      }
    }
  }

  const products = [...tally.values()]
    .sort((a, b) => b.timesBought - a.timesBought)
    .slice(0, limit);

  return ok({ scanned: ids.length, products });
}
