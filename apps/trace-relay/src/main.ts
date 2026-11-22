import type { TraceSpan } from "@checkout/contracts";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { flatten, type OtlpTraceRequest } from "./otlp.js";

// a tiny OTLP/HTTP receiver that fans spans out to browsers over SSE, with a ring buffer for new pages.
const PORT = Number(process.env.PORT ?? 4318);
const BUFFER_SIZE = Number(process.env.TRACE_BUFFER_SIZE ?? 5000);
const BACKLOG_ON_CONNECT = 600;
const MAX_BODY = 5 * 1024 * 1024;
const MAX_CLIENTS = 200;

const buffer: TraceSpan[] = [];
const clients = new Set<ServerResponse>();

function remember(spans: TraceSpan[]) {
  buffer.push(...spans);
  if (buffer.length > BUFFER_SIZE) buffer.splice(0, buffer.length - BUFFER_SIZE);
}

function broadcast(spans: TraceSpan[]) {
  const frame = `event: spans\ndata: ${JSON.stringify(spans)}\n\n`;
  for (const res of clients) res.write(frame);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function ingest(req: IncomingMessage, res: ServerResponse) {
  if (!String(req.headers["content-type"]).includes("json")) {
    return json(res, 415, { error: "only OTLP/HTTP JSON is supported" });
  }
  try {
    const spans = flatten(JSON.parse(await readBody(req)) as OtlpTraceRequest);
    remember(spans);
    if (spans.length > 0) broadcast(spans);
    json(res, 200, {});
  } catch (err) {
    json(res, 400, { error: String(err) });
  }
}

function stream(req: IncomingMessage, res: ServerResponse) {
  if (clients.size >= MAX_CLIENTS) return json(res, 503, { error: "too many viewers" });
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  res.write(`retry: 2000\n\n`);
  res.write(`event: spans\ndata: ${JSON.stringify(buffer.slice(-BACKLOG_ON_CONNECT))}\n\n`);
  clients.add(res);
  req.on("close", () => clients.delete(res));
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://relay");
  if (req.method === "POST" && url.pathname === "/v1/traces") return void ingest(req, res);
  if (req.method === "GET" && url.pathname === "/stream") return stream(req, res);
  if (req.method === "GET" && url.pathname === "/spans") {
    const traceId = url.searchParams.get("traceId");
    return json(res, 200, traceId ? buffer.filter((s) => s.traceId === traceId) : []);
  }
  if (url.pathname === "/healthz") return json(res, 200, { ok: true, clients: clients.size });
  json(res, 404, { error: "not found" });
});

// comment frames keep proxies from closing idle SSE connections.
setInterval(() => {
  for (const res of clients) res.write(`: ping\n\n`);
}, 15_000).unref();

server.listen(PORT, "0.0.0.0", () => console.log(`trace-relay listening on :${PORT}`));

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    for (const res of clients) res.end();
    server.close(() => process.exit(0));
  });
}
