export const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export const shortId = (id: string) => id.slice(0, 8);

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export const ms = (n: number) => (n < 1 ? `${n.toFixed(2)} ms` : n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`);

export const STATE_LABEL: Record<string, string> = {
  AWAITING_STOCK: "Awaiting stock",
  AWAITING_PAYMENT: "Awaiting payment",
  RELEASING_STOCK: "Releasing stock",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
};

export const isTerminal = (state: string) => state === "CONFIRMED" || state === "CANCELLED";

// "checkout.evt.inventory.reserved" → "inventory.reserved"
export const shortType = (type: string) => type.replace(/^checkout\.(cmd|evt)\./, "").replace(/^catalog\.evt\./, "catalog.");

export type Tone = "ok" | "fail" | "comp" | "info";
export function toneOf(type: string): Tone {
  if (/rejected|failed|cancelled/.test(type)) return "fail";
  if (/release|refund/.test(type)) return "comp";
  if (/confirmed|captured|reserved/.test(type)) return "ok";
  return "info";
}
