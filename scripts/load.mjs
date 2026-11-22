// open-loop load test: orders on a fixed schedule, each saga followed to the end.
// usage: node scripts/load.mjs [--rate 100] [--seconds 10] [--url http://localhost:8080]
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const RATE = Number(arg("rate", 100));
const SECONDS = Number(arg("seconds", 10));
const BASE = arg("url", process.env.GATEWAY_URL ?? "http://localhost:8080");

const BASKETS = [
  [{ sku: "mug", quantity: 1 }],
  [{ sku: "tee", quantity: 1 }, { sku: "cap", quantity: 1 }],
  [{ sku: "hoodie", quantity: 1 }],
  [{ sku: "keyboard", quantity: 3 }], // declined → compensation
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (xs, p) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const fmt = (n) => (Number.isFinite(n) ? `${Math.round(n)} ms` : "n/a");

async function post(path, body, headers = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// seed stock runs out within a second, so raise it in the local DB; the restock at the end resets it.
function setDeepStock() {
  try {
    execFileSync("docker", ["compose", "-f", "infra/docker-compose.yaml", "exec", "-T", "db",
      "psql", "-U", "postgres", "-d", "checkout-saga", "-qc", "update inventory.products set stock = 1000000"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
await post("/products/restock");
const deep = arg("seed-stock", null) === null && setDeepStock();
console.log(deep ? "Stock raised for the run (reset afterwards)." : "Running with demo stock levels: expect many out-of-stock rejections.");
console.log(`Placing ${RATE} orders/s for ${SECONDS}s against ${BASE} …`);

const total = RATE * SECONDS;
const statuses = {};
const latencies = [];
const accepted = [];
const started = performance.now();
const inflight = [];

for (let i = 0; i < total; i++) {
  const due = started + (i * 1000) / RATE;
  const wait = due - performance.now();
  if (wait > 1) await sleep(wait);
  const t = performance.now();
  inflight.push(
    post("/orders", { items: BASKETS[i % BASKETS.length] }, { "idempotency-key": randomUUID() })
      .then(({ status, body }) => {
        latencies.push(performance.now() - t);
        statuses[status] = (statuses[status] ?? 0) + 1;
        if (status === 201) accepted.push(body.id);
      })
      .catch((e) => {
        statuses[`error: ${e.cause?.code ?? e.message}`] = (statuses[`error: ${e.cause?.code ?? e.message}`] ?? 0) + 1;
      }),
  );
}
await Promise.all(inflight);
const sendSeconds = (performance.now() - started) / 1000;

const done = new Map();
const deadline = Date.now() + 60_000;
let pending = [...accepted];
while (pending.length && Date.now() < deadline) {
  const batch = pending.splice(0, 50);
  const views = await Promise.all(
    batch.map((id) => fetch(`${BASE}/api/orders/${id}`).then((r) => r.json()).catch(() => null)),
  );
  views.forEach((v, i) => {
    if (v && (v.state === "CONFIRMED" || v.state === "CANCELLED")) done.set(v.id, v);
    else pending.push(batch[i]);
  });
  if (pending.length && batch.length < 50) await sleep(250);
}
const finished = performance.now();

const sagaMs = [...done.values()].map((v) => {
  const t = (v.transitions ?? []).map((x) => +new Date(x.at));
  return t.length ? Math.max(...t) - Math.min(...t) : NaN;
});
const states = {};
for (const v of done.values()) states[v.state] = (states[v.state] ?? 0) + 1;
const firstCreated = Math.min(...[...done.values()].map((v) => +new Date(v.transitions[0].at)));
const lastDone = Math.max(...[...done.values()].map((v) => +new Date(v.transitions.at(-1).at)));

console.log(`
Requests      ${total} sent in ${sendSeconds.toFixed(1)} s (${(total / sendSeconds).toFixed(0)}/s)
Responses     ${Object.entries(statuses).map(([k, v]) => `${k}: ${v}`).join(", ")}
HTTP latency  p50 ${fmt(pct(latencies, 50))} · p95 ${fmt(pct(latencies, 95))} · p99 ${fmt(pct(latencies, 99))}
Sagas         ${done.size}/${accepted.length} finished${pending.length ? `, ${pending.length} still running after 60 s` : ""} (${Object.entries(states).map(([k, v]) => `${k} ${v}`).join(", ")})
Saga time     p50 ${fmt(pct(sagaMs, 50))} · p95 ${fmt(pct(sagaMs, 95))} · max ${fmt(Math.max(...sagaMs))}
Throughput    ${(done.size / ((lastDone - firstCreated) / 1000)).toFixed(0)} sagas/s completed (first order → last saga end)
`);
await post("/products/restock");
process.exit(pending.length ? 1 : 0);
