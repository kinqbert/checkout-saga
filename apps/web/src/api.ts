import type {
  Item,
  NotificationView,
  OrderView,
  ProductView,
  TraceSpan,
} from "@checkout/contracts";

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
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof body?.error === "string" ? body.error : `request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return body as T;
}

export const api = {
  products: () => request<ProductView[]>("/products"),
  restock: () => request<ProductView[]>("/products/restock", { method: "POST" }),
  orders: () => request<OrderView[]>("/orders?limit=25"),
  order: (id: string) => request<OrderView>(`/orders/${id}`),
  notifications: () => request<NotificationView[]>("/notifications?limit=12"),
  trace: (traceId: string) => request<TraceSpan[]>(`/traces/${traceId}`),
  placeOrder: (items: Item[], idempotencyKey: string) =>
    request<OrderView>("/orders", {
      method: "POST",
      body: JSON.stringify({ items }),
      headers: { "idempotency-key": idempotencyKey },
    }),
};
