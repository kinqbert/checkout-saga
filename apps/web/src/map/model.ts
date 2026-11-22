import type { TraceSpan } from "@checkout/contracts";
import { Position } from "@xyflow/react";
import type { JSX, SVGProps } from "react";
import { toneOf, type Tone } from "../format";
import { Box, Card, Envelope, Globe, Receipt } from "../icons";


export type ServiceId = "gateway" | "order" | "inventory" | "payment" | "notify";

interface Service {
  label: string;
  role: string;
  Icon: (p: SVGProps<SVGSVGElement>) => JSX.Element;
  listens: string[];
  emits: string[];
}

export const SERVICES: Record<ServiceId, Service> = {
  gateway: { label: "Gateway", role: "Public HTTP API", Icon: Globe, listens: ["POST /orders"], emits: ["→ Order (HTTP)"] },
  order: {
    label: "Order",
    role: "Saga orchestrator",
    Icon: Receipt,
    listens: ["inventory.reserved", "inventory.rejected", "inventory.released", "payment.captured", "payment.failed", "payment.refunded", "catalog.product.upserted"],
    emits: ["inventory.reserve", "inventory.release", "payment.capture", "payment.refund", "order.confirmed", "order.cancelled"],
  },
  inventory: {
    label: "Inventory",
    role: "Stock and catalogue",
    Icon: Box,
    listens: ["inventory.reserve", "inventory.release"],
    emits: ["inventory.reserved", "inventory.rejected", "inventory.released", "catalog.product.upserted"],
  },
  payment: {
    label: "Payment",
    role: "Card provider",
    Icon: Card,
    listens: ["payment.capture", "payment.refund"],
    emits: ["payment.captured", "payment.failed", "payment.refunded"],
  },
  notify: { label: "Notify", role: "E-mail, after the saga", Icon: Envelope, listens: ["order.confirmed", "order.cancelled"], emits: [] },
};

export const SERVICE_IDS = Object.keys(SERVICES) as ServiceId[];
export const isService = (s: string): s is ServiceId => s in SERVICES;

export type EdgeId = "http" | "reserve" | "stockEvt" | "capture" | "payEvt" | "outcome";
export type Layout = "wide" | "narrow";
type Side = "l" | "r" | "t" | "b";
// where a line meets a card: side, and percent along it.
type Anchor = [Side, number];

// each out/back pair is an exact parallel shift (same gap at both ends), so the curves never cross.
export const EDGES: { id: EdgeId; source: ServiceId; target: ServiceId; wide: [Anchor, Anchor]; narrow: [Anchor, Anchor] }[] = [
  { id: "http", source: "gateway", target: "order", wide: [["r", 50], ["l", 50]], narrow: [["b", 50], ["t", 50]] },
  { id: "reserve", source: "order", target: "inventory", wide: [["r", 19], ["l", 33]], narrow: [["b", 22], ["t", 40]] },
  { id: "stockEvt", source: "inventory", target: "order", wide: [["l", 61], ["r", 47]], narrow: [["t", 54], ["b", 36]] },
  { id: "capture", source: "order", target: "payment", wide: [["r", 56], ["l", 42]], narrow: [["b", 78], ["t", 60]] },
  { id: "payEvt", source: "payment", target: "order", wide: [["l", 70], ["r", 84]], narrow: [["t", 46], ["b", 64]] },
  { id: "outcome", source: "order", target: "notify", wide: [["b", 50], ["t", 50]], narrow: [["b", 50], ["t", 50]] },
];

export const handleId = (edge: EdgeId, layout: Layout, end: "s" | "t") => `${edge}:${layout}:${end}`;

const POSITION: Record<Side, Position> = { l: Position.Left, r: Position.Right, t: Position.Top, b: Position.Bottom };

export function anchorsFor(node: ServiceId) {
  const out: { id: string; type: "source" | "target"; position: Position; style: { top: string } | { left: string } }[] = [];
  const at = ([side, pct]: Anchor) => ({
    position: POSITION[side],
    // cards share one fixed height, so percentages keep paired lines parallel.
    style: side === "l" || side === "r" ? { top: `${pct}%` } : { left: `${pct}%` },
  });
  for (const e of EDGES)
    for (const layout of ["wide", "narrow"] as const) {
      if (e.source === node) out.push({ id: handleId(e.id, layout, "s"), type: "source", ...at(e[layout][0]) });
      if (e.target === node) out.push({ id: handleId(e.id, layout, "t"), type: "target", ...at(e[layout][1]) });
    }
  return out;
}

type Positions = Record<ServiceId, { x: number; y: number }>;
export const POSITIONS: Record<"wide" | "tight" | "narrow", Positions> = {
  wide: { gateway: { x: 0, y: 200 }, order: { x: 360, y: 200 }, inventory: { x: 820, y: 30 }, payment: { x: 820, y: 370 }, notify: { x: 360, y: 450 } },
  tight: { gateway: { x: 0, y: 200 }, order: { x: 320, y: 200 }, inventory: { x: 700, y: 30 }, payment: { x: 700, y: 370 }, notify: { x: 320, y: 450 } },
  narrow: { gateway: { x: 130, y: 0 }, order: { x: 130, y: 160 }, inventory: { x: 0, y: 340 }, payment: { x: 260, y: 340 }, notify: { x: 130, y: 500 } },
};

export const PANEL_SIDE: Record<Layout, Record<ServiceId, Position>> = {
  wide: { gateway: Position.Bottom, order: Position.Top, inventory: Position.Bottom, payment: Position.Top, notify: Position.Right },
  narrow: { gateway: Position.Bottom, order: Position.Bottom, inventory: Position.Top, payment: Position.Top, notify: Position.Top },
};

export const messageType = (s: TraceSpan) => String(s.attributes["messaging.message.type"] ?? "");

export function edgeFor(span: TraceSpan): EdgeId | undefined {
  if (span.kind === "client" && span.service === "gateway" && span.attributes["peer.service"] === "order" && span.name.startsWith("POST"))
    return "http";
  if (span.kind !== "producer") return undefined;
  const type = messageType(span);
  if (type.startsWith("checkout.cmd.inventory.")) return "reserve";
  if (type.startsWith("checkout.evt.inventory.") || type.startsWith("catalog.")) return "stockEvt";
  if (type.startsWith("checkout.cmd.payment.")) return "capture";
  if (type.startsWith("checkout.evt.payment.")) return "payEvt";
  if (type.startsWith("checkout.evt.order.")) return "outcome";
  return undefined;
}

export const destination = (edge: EdgeId): ServiceId => EDGES.find((e) => e.id === edge)!.target;

// each line takes the colour of its worst message (failure > undo > success).
export function pathTones(spans: TraceSpan[]): Partial<Record<EdgeId, Tone>> {
  const rank: Record<Tone, number> = { info: 0, ok: 1, comp: 2, fail: 3 };
  const out: Partial<Record<EdgeId, Tone>> = {};
  let outcome: Tone | undefined;
  for (const s of spans) {
    const edge = edgeFor(s);
    if (!edge) continue;
    const type = messageType(s);
    const tone: Tone = type ? toneOf(type) : "ok";
    if (type.startsWith("checkout.evt.order.")) outcome = tone;
    const cur = out[edge];
    if (!cur || rank[tone] > rank[cur]) out[edge] = tone;
  }
  for (const k of Object.keys(out) as EdgeId[]) if (out[k] === "info") out[k] = "ok";
  out.http = outcome ?? "info";
  return out;
}
