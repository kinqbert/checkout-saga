import {
  PlaceOrderRequest,
  type NotificationView,
  type OrderView,
  type ProductView,
} from "@checkout/contracts";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  type BeforeApplicationShutdown,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Readable } from "node:stream";
import { RateLimiter } from "./rate-limit.js";
import { Upstream, upstreams } from "./upstream.js";

const limitParam = (v?: string) => String(Math.min(Math.max(Number(v) || 20, 1), 100));

/** Public API for the web UI. It validates input and fans out to internal services. */
@Controller("api")
export class ApiController implements BeforeApplicationShutdown {
  /** Open SSE streams; closed on shutdown so the HTTP server can stop promptly. */
  private readonly streams = new Set<{ abort: AbortController; res: Response }>();
  private readonly orderLimiter = new RateLimiter(20, 0.5);
  private readonly adminLimiter = new RateLimiter(10, 0.2);

  constructor(private readonly upstream: Upstream) {}

  beforeApplicationShutdown() {
    for (const s of this.streams) {
      s.abort.abort();
      s.res.end();
    }
    this.streams.clear();
  }

  @Get("products")
  async products(): Promise<ProductView[]> {
    return (await this.upstream.call<ProductView[]>("inventory", "/products")).body;
  }

  @Post("products/restock")
  async restock(@Ip() ip: string): Promise<ProductView[]> {
    this.adminLimiter.take(ip);
    return (await this.upstream.call<ProductView[]>("inventory", "/products/restock", { method: "POST" })).body;
  }

  @Patch("products/:sku")
  async setPrice(@Ip() ip: string, @Param("sku") sku: string, @Body() body: unknown): Promise<ProductView> {
    this.adminLimiter.take(ip);
    const path = `/products/${encodeURIComponent(sku)}`;
    return (await this.upstream.call<ProductView>("inventory", path, { method: "PATCH", body })).body;
  }

  @Post("orders")
  async placeOrder(
    @Ip() ip: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderView> {
    this.orderLimiter.take(ip);
    const parsed = PlaceOrderRequest.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ error: "invalid order", details: parsed.error.issues });
    }
    const { status, body: order } = await this.upstream.call<OrderView>("order", "/orders", {
      method: "POST",
      body: parsed.data,
      headers: key ? { "idempotency-key": key } : {},
    });
    res.status(status);
    return order;
  }

  @Get("orders")
  async orders(@Query("limit") limit?: string): Promise<OrderView[]> {
    return (await this.upstream.call<OrderView[]>("order", `/orders?limit=${limitParam(limit)}`)).body;
  }

  @Get("orders/:id")
  async order(@Param("id", new ParseUUIDPipe()) id: string): Promise<OrderView> {
    return (await this.upstream.call<OrderView>("order", `/orders/${id}`)).body;
  }

  @Get("notifications")
  async notifications(@Query("limit") limit?: string): Promise<NotificationView[]> {
    const path = `/notifications?limit=${limitParam(limit)}`;
    return (await this.upstream.call<NotificationView[]>("notify", path)).body;
  }

  @Get("traces/:traceId")
  async trace(@Param("traceId") traceId: string): Promise<unknown> {
    if (!/^[0-9a-f]{32}$/.test(traceId)) throw new BadRequestException({ error: "bad trace id" });
    const res = await fetch(`${upstreams.traces}/spans?traceId=${traceId}`).catch(() => undefined);
    return res?.ok ? res.json() : [];
  }

  /** Pipes trace-relay's Server-Sent Events stream through to the browser. */
  @Get("stream")
  async stream(@Req() req: Request, @Res() res: Response): Promise<void> {
    const abort = new AbortController();
    const entry = { abort, res };
    this.streams.add(entry);
    req.on("close", () => {
      abort.abort();
      this.streams.delete(entry);
    });
    let upstream: globalThis.Response;
    try {
      upstream = await fetch(`${upstreams.traces}/stream`, { signal: abort.signal });
    } catch {
      res.status(503).json({ error: "trace relay unavailable" });
      return;
    }
    if (!upstream.ok || !upstream.body) {
      res.status(503).json({ error: "trace relay unavailable" });
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream)
      .on("error", () => res.end())
      .pipe(res);
  }
}
