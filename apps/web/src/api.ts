import type {
  Item,
  NotificationView,
  OrderView,
  ProductView,
  TraceSpan,
} from "@checkout/contracts";

export type Pace = "realtime" | "slow";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    const msg = typeof body?.error === "string" ? body.error : `request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  if (body === undefined) throw new ApiError(res.status, "the API answered with something that isn't JSON");
  return body as T;
}

const randomHex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

// this browser's failure-lab id: faults apply only to orders carrying it.
export const labId: string = (() => {
  try {
    const saved = localStorage.getItem("checkout-saga:lab");
    if (saved) return saved;
    const fresh = crypto.randomUUID();
    localStorage.setItem("checkout-saga:lab", fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
})();

export interface LabSnapshot {
  downUntil: string | null;
  slowUntil: string | null;
  crashArmed: boolean;
  killArmed: boolean;
}
export type LabState = Record<"inventory" | "payment" | "order", LabSnapshot>;
export type LabService = keyof LabState;
export type LabFault = "down" | "slow" | "crash" | "kill";

export const labActive = (lab: LabState | undefined): boolean =>
  !!lab &&
  Object.values(lab).some((s) => !!s && (!!s.downUntil || !!s.slowUntil || s.crashArmed || s.killArmed));

export const newTraceId = () => randomHex(16);

export const api = {
  lab: () => request<LabState>("/lab", { headers: { "x-demo-lab": labId } }),
  setLab: (service: LabService, fault: LabFault, on: boolean) =>
    request<LabSnapshot>("/lab", {
      method: "PUT",
      body: JSON.stringify({ service, fault, on }),
      headers: { "x-demo-lab": labId },
    }),
  products: () => request<ProductView[]>("/products"),
  restock: () => request<ProductView[]>("/products/restock", { method: "POST" }),
  orders: () => request<OrderView[]>("/orders?limit=25"),
  order: (id: string) => request<OrderView>(`/orders/${id}`),
  notifications: () => request<NotificationView[]>("/notifications?limit=12"),
  trace: (traceId: string) => request<TraceSpan[]>(`/traces/${traceId}`),
  // the browser starts the trace, so it knows the id before the saga's first span arrives.
  placeOrder: (items: Item[], idempotencyKey: string, pace: Pace, traceId: string) =>
    request<OrderView>("/orders", {
      method: "POST",
      body: JSON.stringify({ items }),
      headers: {
        "idempotency-key": idempotencyKey,
        "x-demo-pace": pace,
        "x-demo-lab": labId,
        traceparent: `00-${traceId}-${randomHex(8)}-01`,
      },
    }),
};
