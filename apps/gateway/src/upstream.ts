import { currentTraceHeaders, SpanKind, trace, withSpan, type Span } from "@checkout/telemetry";
import { HttpException, Injectable, ServiceUnavailableException } from "@nestjs/common";

export const upstreams = {
  order: process.env.ORDER_URL ?? "http://localhost:3001",
  inventory: process.env.INVENTORY_URL ?? "http://localhost:3002",
  payment: process.env.PAYMENT_URL ?? "http://localhost:3003",
  notify: process.env.NOTIFY_URL ?? "http://localhost:3004",
  traces: process.env.TRACE_RELAY_URL ?? "http://localhost:4318",
};

export interface UpstreamResponse<T> {
  status: number;
  body: T;
}

interface CallInit {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

// fetch() to an internal service. Inside a traced request it adds a CLIENT
// span and forwards `traceparent`; untraced reads stay untraced.
@Injectable()
export class Upstream {
  call<T>(service: keyof typeof upstreams, path: string, init: CallInit = {}): Promise<UpstreamResponse<T>> {
    const method = init.method ?? "GET";
    if (!trace.getActiveSpan()) return this.send<T>(service, path, method, init);
    return withSpan(
      `${method} ${service}${path.split("?")[0]}`,
      { kind: SpanKind.CLIENT, attributes: { "peer.service": service } },
      (span) => this.send<T>(service, path, method, init, span),
    );
  }

  private async send<T>(
    service: keyof typeof upstreams,
    path: string,
    method: string,
    init: CallInit,
    span?: Span,
  ): Promise<UpstreamResponse<T>> {
    let res: Response;
    try {
      res = await fetch(`${upstreams[service]}${path}`, {
        method,
        headers: {
          ...currentTraceHeaders(),
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new ServiceUnavailableException({ error: `${service} is unavailable` });
    }
    span?.setAttribute("http.response.status_code", res.status);
    const body = (await res.json().catch(() => ({}))) as T;
    if (res.status >= 400) throw new HttpException(body as object, res.status);
    return { status: res.status, body };
  }
}
