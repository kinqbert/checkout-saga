// End-to-end check of every saga path, through the public gateway API.
// Usage: GATEWAY_URL=http://localhost:8080 node scripts/e2e.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const BASE = process.env.GATEWAY_URL ?? "http://localhost:8080";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, init = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const placeOrder = (items, key) =>
  api("/orders", { method: "POST", body: { items }, headers: key ? { "idempotency-key": key } : {} });

async function settle(id, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const { body } = await api(`/orders/${id}`);
    if (body.state === "CONFIRMED" || body.state === "CANCELLED") return body;
    await sleep(150);
  }
  throw new Error(`order ${id} did not settle`);
}

const stockOf = async (sku) => (await api("/products")).body.find((p) => p.sku === sku).stock;

async function step(name, fn) {
  process.stdout.write(`• ${name} … `);
  const t = Date.now();
  await fn();
  console.log(`ok (${Date.now() - t} ms)`);
}

await step("catalog is replicated to the order service", async () => {
  for (let i = 0; i < 60; i++) {
    const r = await placeOrder([{ sku: "mug", quantity: 1 }]);
    if (r.status === 201) return settle(r.body.id);
    await sleep(500);
  }
  throw new Error("order service never learned the catalog");
});

await step("restock", async () => {
  const { status, body } = await api("/products/restock", { method: "POST" });
  assert.equal(status, 201);
  assert.equal(body.find((p) => p.sku === "sneakers").stock, 3);
});

await step("happy path → CONFIRMED, priced server-side, e-mail sent", async () => {
  const before = await stockOf("tee");
  const { status, body } = await placeOrder([{ sku: "tee", quantity: 2 }, { sku: "mug", quantity: 1 }]);
  assert.equal(status, 201);
  assert.equal(body.amount, 2 * 2400 + 1200);
  const order = await settle(body.id);
  assert.equal(order.state, "CONFIRMED");
  assert.deepEqual(
    order.transitions.map((t) => t.to),
    ["AWAITING_STOCK", "AWAITING_PAYMENT", "CONFIRMED"],
  );
  assert.equal(await stockOf("tee"), before - 2);
  await sleep(500);
  const notes = (await api("/notifications")).body;
  assert.ok(notes.some((n) => n.orderId === order.id && n.kind === "confirmed"));
});

await step("payment declined → stock released (compensation) → CANCELLED", async () => {
  const before = await stockOf("keyboard");
  const { body } = await placeOrder([{ sku: "keyboard", quantity: 3 }]);
  const order = await settle(body.id);
  assert.equal(order.state, "CANCELLED");
  assert.match(order.cancelReason, /card declined/);
  assert.deepEqual(
    order.transitions.map((t) => t.to),
    ["AWAITING_STOCK", "AWAITING_PAYMENT", "RELEASING_STOCK", "CANCELLED"],
  );
  assert.equal(await stockOf("keyboard"), before);
});

await step("out of stock → CANCELLED without touching stock", async () => {
  const { body } = await placeOrder([{ sku: "sneakers", quantity: 4 }]);
  const order = await settle(body.id);
  assert.equal(order.state, "CANCELLED");
  assert.match(order.cancelReason, /out of stock/);
  assert.equal(await stockOf("sneakers"), 3);
});

await step("concurrent orders never oversell (5 buyers, 3 sneakers)", async () => {
  const placed = await Promise.all(
    Array.from({ length: 5 }, () => placeOrder([{ sku: "tee", quantity: 1 }, { sku: "sneakers", quantity: 1 }])),
  );
  const settled = await Promise.all(placed.map((r) => settle(r.body.id)));
  const confirmed = settled.filter((o) => o.state === "CONFIRMED").length;
  assert.equal(confirmed, 3);
  assert.equal(await stockOf("sneakers"), 0);
});

await step("idempotency key → same order, no duplicate", async () => {
  const key = randomUUID();
  const a = await placeOrder([{ sku: "cap", quantity: 1 }], key);
  const b = await placeOrder([{ sku: "cap", quantity: 1 }], key);
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  assert.equal(a.body.id, b.body.id);
  await settle(a.body.id);
});

await step("validation: unknown sku → 422, bad body → 400", async () => {
  assert.equal((await placeOrder([{ sku: "nope", quantity: 1 }])).status, 422);
  assert.equal((await placeOrder([])).status, 400);
  assert.equal((await placeOrder([{ sku: "tee", quantity: 0 }])).status, 400);
});

await step("one trace spans every service of a saga", async () => {
  const { body } = await placeOrder([{ sku: "mug", quantity: 1 }]);
  const order = await settle(body.id);
  assert.ok(order.traceId);
  let services = new Set();
  for (let i = 0; i < 20 && services.size < 5; i++) {
    await sleep(250);
    services = new Set((await api(`/traces/${order.traceId}`)).body.map((s) => s.service));
  }
  assert.deepEqual([...services].sort(), ["gateway", "inventory", "notify", "order", "payment"]);
});

await api("/products/restock", { method: "POST" });
console.log("\nall good ✔");
