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
  Put,
  Query,
  Req,
  Res,
  type BeforeApplicationShutdown,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Readable } from "node:stream";
import { LAB_KEY, PACE_KEY, withBaggage } from "@checkout/telemetry";
import * as z from "zod";
import { RateLimiter } from "./rate-limit.js";
import { Upstream, upstreams } from "./upstream.js";

const ORDER_RATE = Number(process.env.ORDER_RATE_PER_SECOND ?? 100);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LAB_FAULTS = {
  inventory: ["down", "crash"],
  payment: ["down", "slow"],
  order: ["kill"],
} as const;
const LabChange = z
  .object({
    service: z.enum(["inventory", "payment", "order"]),
    fault: z.enum(["down", "slow", "crash", "kill"]),
    on: z.boolean(),
  })
  .refine((c) => (LAB_FAULTS[c.service] as readonly string[]).includes(c.fault), {
    message: "that fault is not an experiment for that service",
  });

const limitParam = (v?: string) => String(Math.min(Math.max(Number(v) || 20, 1), 100));

@Controller("api")
export class ApiController implements BeforeApplicationShutdown {
  // open SSE streams, closed on shutdown so the server can stop promptly.
  private readonly streams = new Set<{ abort: AbortController; res: Response }>();
  private readonly orderLimiter = new RateLimiter(ORDER_RATE, ORDER_RATE);
  private readonly adminLimiter = new RateLimiter(20, 2);

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
    @Headers("x-demo-pace") pace: string | undefined,
    @Headers("x-demo-lab") lab: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderView> {
    this.orderLimiter.take(ip, res);
    const parsed = PlaceOrderRequest.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ error: "invalid order", details: parsed.error.issues });
    }
    // slow mode and the lab id ride along as baggage; only the gateway sets it (client baggage is dropped).
    const call = () =>
      this.upstream.call<OrderView>("order", "/orders", {
        method: "POST",
        body: parsed.data,
        headers: key ? { "idempotency-key": key } : {},
      });
    const baggage: Record<string, string> = { [PACE_KEY]: pace === "slow" ? "slow" : "realtime" };
    if (lab && UUID.test(lab)) baggage[LAB_KEY] = lab.toLowerCase();
    const { status, body: order } = await withBaggage(baggage, call);
    res.status(status);
    return order;
  }

  @Get("lab")
  async lab(@Headers("x-demo-lab") lab: string | undefined): Promise<unknown> {
    const id = this.labId(lab);
    const [inventory, payment, order] = await Promise.all([
      this.upstream.call("inventory", `/lab/${id}`),
      this.upstream.call("payment", `/lab/${id}`),
      this.upstream.call("order", `/lab/${id}`),
    ]);
    return { inventory: inventory.body, payment: payment.body, order: order.body };
  }

  @Put("lab")
  async setLab(@Ip() ip: string, @Headers("x-demo-lab") lab: string | undefined, @Body() body: unknown): Promise<unknown> {
    this.adminLimiter.take(ip);
    const id = this.labId(lab);
    const parsed = LabChange.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ error: "invalid lab change", details: parsed.error.issues });
    const { service, fault, on } = parsed.data;
    return (await this.upstream.call(service, `/lab/${id}`, { method: "PUT", body: { fault, on } })).body;
  }

  private labId(lab: string | undefined): string {
    if (!lab || !UUID.test(lab)) throw new BadRequestException({ error: "x-demo-lab must be a UUID" });
    return lab.toLowerCase();
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
