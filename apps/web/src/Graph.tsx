import type { TraceSpan } from "@checkout/contracts";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  NodeToolbar,
  Position,
  ReactFlow,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ago, ms as fmtMs, shortType, STATE_LABEL, toneOf, type Tone } from "./format";
import { api } from "./api";
import { traceStore, useTraceVersion } from "./traceStore";

export type ServiceId =
  | "gateway"
  | "order"
  | "inventory"
  | "payment"
  | "notify";

const SERVICES: Record<ServiceId, { label: string; role: string; listens: string[]; emits: string[] }> = {
  gateway: { label: "Gateway", role: "Public HTTP API", listens: ["POST /orders"], emits: ["→ Order (HTTP)"] },
  order: {
    label: "Order",
    role: "Saga orchestrator",
    listens: ["inventory.reserved", "inventory.rejected", "inventory.released", "payment.captured", "payment.failed", "catalog.product.upserted"],
    emits: ["inventory.reserve", "inventory.release", "payment.capture", "order.confirmed", "order.cancelled"],
  },
  inventory: {
    label: "Inventory",
    role: "Stock and catalogue",
    listens: ["inventory.reserve", "inventory.release"],
    emits: ["inventory.reserved", "inventory.rejected", "inventory.released", "catalog.product.upserted"],
  },
  payment: { label: "Payment", role: "Card provider", listens: ["payment.capture"], emits: ["payment.captured", "payment.failed"] },
  notify: { label: "Notify", role: "E-mail, after the saga", listens: ["order.confirmed", "order.cancelled"], emits: [] },
};

/** Two lines per pair of services: one outgoing, one returning. */
type EdgeId =
  | "http"
  | "reserve"
  | "stockEvt"
  | "capture"
  | "payEvt"
  | "outcome";
type Side = "l" | "r" | "t" | "b";

/** An anchor on a card edge: which side, and how far along it (percent). */
type Anchor = [Side, number];
type Layout = "wide" | "narrow";

/**
 * Each pair (out and back) is an exact parallel shift: both ends are spaced
 * the same distance apart, so the two curves never pinch or cross. On Order's
 * right edge, top to bottom: to Inventory, from Inventory, to Payment, from
 * Payment.
 */
const EDGES: {
  id: EdgeId;
  source: ServiceId;
  target: ServiceId;
  wide: [Anchor, Anchor];
  narrow: [Anchor, Anchor];
}[] = [
  {
    id: "http",
    source: "gateway",
    target: "order",
    wide: [
      ["r", 50],
      ["l", 50],
    ],
    narrow: [
      ["b", 50],
      ["t", 50],
    ],
  },
  {
    id: "reserve",
    source: "order",
    target: "inventory",
    wide: [
      ["r", 19],
      ["l", 33],
    ],
    narrow: [
      ["b", 22],
      ["t", 40],
    ],
  },
  {
    id: "stockEvt",
    source: "inventory",
    target: "order",
    wide: [
      ["l", 61],
      ["r", 47],
    ],
    narrow: [
      ["t", 54],
      ["b", 36],
    ],
  },
  {
    id: "capture",
    source: "order",
    target: "payment",
    wide: [
      ["r", 56],
      ["l", 42],
    ],
    narrow: [
      ["b", 78],
      ["t", 60],
    ],
  },
  {
    id: "payEvt",
    source: "payment",
    target: "order",
    wide: [
      ["l", 70],
      ["r", 84],
    ],
    narrow: [
      ["t", 46],
      ["b", 64],
    ],
  },
  {
    id: "outcome",
    source: "order",
    target: "notify",
    wide: [
      ["b", 50],
      ["t", 50],
    ],
    narrow: [
      ["b", 50],
      ["t", 50],
    ],
  },
];

/**
 * A full S-curve: control points sit 60% along the run (React Flow's default
 * is 50%), so the line bends the whole way instead of running a straight
 * diagonal through the middle.
 */
function softCurve(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  vertical: boolean,
): [string, number, number] {
  const k = 0.15;
  const c = vertical
    ? `C ${sx},${sy + (ty - sy) * k} ${tx},${ty - (ty - sy) * k}`
    : `C ${sx + (tx - sx) * k},${sy} ${tx - (tx - sx) * k},${ty}`;
  return [`M ${sx},${sy} ${c} ${tx},${ty}`, (sx + tx) / 2, (sy + ty) / 2];
}

const handleId = (edge: EdgeId, layout: Layout, end: "s" | "t") =>
  `${edge}:${layout}:${end}`;

/** The anchors a card needs, for both layouts (unused ones are harmless). */
function anchorsFor(node: ServiceId) {
  const out: {
    id: string;
    type: "source" | "target";
    side: Side;
    pct: number;
  }[] = [];
  for (const e of EDGES) {
    for (const layout of ["wide", "narrow"] as const) {
      const [src, tgt] = e[layout];
      if (e.source === node)
        out.push({
          id: handleId(e.id, layout, "s"),
          type: "source",
          side: src[0],
          pct: src[1],
        });
      if (e.target === node)
        out.push({
          id: handleId(e.id, layout, "t"),
          type: "target",
          side: tgt[0],
          pct: tgt[1],
        });
    }
  }
  return out;
}

/**
 * Your own request leaves the browser the moment you click, but its span only
 * arrives after the request finishes. So the page draws that first hop itself.
 */
type LocalListener = () => () => void;
const localListeners = new Set<LocalListener>();
/** Call when your request leaves; call the returned function when it has answered. */
export function announceOwnRequest(): () => void {
  const done = [...localListeners].map((l) => l());
  return () => done.forEach((d) => d());
}

/** Which arrow a span travels along, based on what it published or called. */
function edgeFor(
  span: TraceSpan,
): { edge: EdgeId; reverse: boolean } | undefined {
  if (
    span.kind === "client" &&
    span.service === "gateway" &&
    span.attributes["peer.service"] === "order" &&
    span.name.startsWith("POST")
  )
    return { edge: "http", reverse: false };
  if (span.kind !== "producer") return undefined;
  const type = String(span.attributes["messaging.message.type"] ?? "");
  if (type.startsWith("checkout.cmd.inventory."))
    return { edge: "reserve", reverse: false };
  if (type.startsWith("checkout.evt.inventory.") || type.startsWith("catalog."))
    return { edge: "stockEvt", reverse: false };
  if (type.startsWith("checkout.cmd.payment."))
    return { edge: "capture", reverse: false };
  if (type.startsWith("checkout.evt.payment."))
    return { edge: "payEvt", reverse: false };
  if (type.startsWith("checkout.evt.order."))
    return { edge: "outcome", reverse: false };
  return undefined;
}

interface Pulse {
  id: string;
  /** travel time in ms: slower in slow mode, so the dot is easy to follow */
  ms: number;
  tone: Tone;
  label: string;
  mine: boolean;
  /** travels target → source (a reply on a shared line) */
  reverse?: boolean;
}

type ServiceNodeData = {
  id: ServiceId;
  flash: number;
  tone: Tone;
  /** failure lab: this service is down for your orders */
  down: boolean;
  /** a message of yours has arrived and this service is still working on it */
  busy: boolean;
  /** failure lab: your messages refused by this service, waiting for redelivery */
  waiting: { count: number; retry: number } | undefined;
  /** what the service is doing or just did; the stats show when there is nothing */
  status: Status | undefined;
  stats: Stats | undefined;
  /** the card's detail panel is open */
  open: boolean;
  /** which side of the card the panel opens on */
  panelSide: Position;
  onClose: () => void;
  /** recent events at this service, newest first */
  log: LogEntry[];
};

/** One line in a card's panel: a message in or out, or the gateway's HTTP hop. */
type LogEntry = {
  id: string;
  dir: "in" | "out";
  label: string;
  tone: Tone;
  at: number;
  ms?: number | undefined;
  mine: boolean;
  error: boolean;
};
const LOG_SIZE = 8;

/** Live counters on a card: work handled since the page opened, and its typical time. */
type Stats = { handled: number; recent: number[] };
const STATS_WINDOW = 20;

type Status = { text: string; tone: Tone; doing?: boolean };

/** What a service is doing while it works on a message of this type ("http" = your POST). */
const DOING: Record<string, string> = {
  http: "Placing order…",
  "checkout.cmd.inventory.reserve": "Reserving stock…",
  "checkout.cmd.inventory.release": "Releasing stock…",
  "checkout.cmd.payment.capture": "Charging card…",
  "checkout.evt.inventory.reserved": "Handling stock reply…",
  "checkout.evt.inventory.rejected": "Handling stock reply…",
  "checkout.evt.inventory.released": "Handling stock reply…",
  "checkout.evt.payment.captured": "Handling payment reply…",
  "checkout.evt.payment.failed": "Handling payment reply…",
  "checkout.evt.order.confirmed": "Emailing confirmation…",
  "checkout.evt.order.cancelled": "Emailing cancellation…",
};

/** What a service just did, told by the message it sent. */
const DONE: Record<string, Status> = {
  "checkout.cmd.inventory.reserve": { text: "Asked for stock", tone: "info" },
  "checkout.cmd.inventory.release": { text: "Asked to release stock", tone: "comp" },
  "checkout.cmd.payment.capture": { text: "Asked for payment", tone: "info" },
  "checkout.evt.inventory.reserved": { text: "Stock reserved", tone: "ok" },
  "checkout.evt.inventory.rejected": { text: "Out of stock", tone: "fail" },
  "checkout.evt.inventory.released": { text: "Stock released", tone: "comp" },
  "checkout.evt.payment.captured": { text: "Payment captured", tone: "ok" },
  "checkout.evt.payment.failed": { text: "Card declined", tone: "fail" },
  "checkout.evt.order.confirmed": { text: "Order confirmed", tone: "ok" },
  "checkout.evt.order.cancelled": { text: "Order cancelled", tone: "fail" },
};
/** Notify sends nothing back, so its result is told by the message it handled. */
const NOTIFY_DONE: Record<string, Status> = {
  "checkout.evt.order.confirmed": { text: "Confirmation emailed", tone: "ok" },
  "checkout.evt.order.cancelled": { text: "Cancellation emailed", tone: "fail" },
};
/** How long a "done" status stays before the card falls back to its stats. */
const DONE_MS = 3000;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/**
 * The span that counts as one unit of work for a service: a message it
 * processed, or (for the gateway) an order request it forwarded.
 */
function workOf(s: TraceSpan): ServiceId | undefined {
  if (s.service === "gateway") return edgeFor(s)?.edge === "http" ? "gateway" : undefined;
  if (s.kind !== "consumer" || !s.attributes["messaging.message.type"]) return undefined;
  if (s.attributes["demo.lab.refused"]) return undefined;
  return s.service in SERVICES ? (s.service as ServiceId) : undefined;
}

/**
 * Slow mode holds each message ~1 s at the receiving service. The dot travels
 * for about half of that, so it lands while the service is still working on it.
 */
const SLOW_TRAVEL_MS = 450;

/** Which service a message on an edge is heading to. */
function destination(edge: EdgeId, reverse: boolean): ServiceId {
  const e = EDGES.find((x) => x.id === edge)!;
  return reverse ? e.source : e.target;
}
type ServiceNode = Node<ServiceNodeData, "service">;
type PulseEdgeData = {
  pulses: Pulse[];
  vertical: boolean;
  /** the selected order travelled this line; lit in its outcome colour */
  pathTone?: Tone | undefined;
};
type PulseEdge = Edge<PulseEdgeData, "pulse">;

const POSITION: Record<Side, Position> = {
  l: Position.Left,
  r: Position.Right,
  t: Position.Top,
  b: Position.Bottom,
};

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const ServiceNodeView = memo(function ServiceNodeView({
  data,
}: NodeProps<ServiceNode>) {
  const svc = SERVICES[data.id];
  return (
    <div
      className={`node node-${data.id} ${data.down ? "is-down" : ""} ${data.open ? "is-open" : ""}`}
      aria-expanded={data.open}
      title={data.open ? undefined : `Show recent events at ${svc.label}`}
    >
      {data.flash > 0 && (
        <span key={data.flash} className={`node-ring tone-${data.tone}`} />
      )}
      {anchorsFor(data.id).map((a) => (
        <Handle
          key={a.id}
          id={a.id}
          type={a.type}
          position={POSITION[a.side]}
          isConnectable={false}
          // Side anchors are measured in px from the top of the card at its
          // resting height (72px), so a card growing its status line keeps
          // its lines in place.
          style={
            a.side === "l" || a.side === "r"
              ? { top: `${Math.round((a.pct / 100) * 72)}px` }
              : { left: `${a.pct}%` }
          }
        />
      ))}
      <span className="node-head">
        <span className="node-name">{svc.label}</span>
        {data.down ? (
          <span className="node-down">Down</span>
        ) : (
          <span
            className={`node-spinner ${data.busy ? "is-on" : ""}`}
            role="status"
            aria-label={data.busy ? `${svc.label} is working` : undefined}
          />
        )}
      </span>
      <span className="node-role">{svc.role}</span>
      <NodeStatus id={data.id} status={data.status} stats={data.stats} />
      <NodeToolbar isVisible={data.open} position={data.panelSide} offset={12}>
        <NodePanel id={data.id} log={data.log} onClose={data.onClose} />
      </NodeToolbar>
    </div>
  );
});

/** Opens beside a clicked card: what the service just did, and what it speaks. */
function NodePanel({ id, log, onClose }: { id: ServiceId; log: LogEntry[]; onClose: () => void }) {
  const svc = SERVICES[id];
  // Re-render every few seconds so "12s ago" keeps moving.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="panel nodrag nopan" role="dialog" aria-label={`Recent events at ${svc.label}`} onClick={(e) => e.stopPropagation()}>
      <div className="panel-head">
        <span>Recent at {svc.label}</span>
        <button className="panel-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      {log.length === 0 ? (
        <p className="panel-empty">Nothing yet. Place an order and watch it land here.</p>
      ) : (
        <ul className="panel-log">
          {log.map((e) => (
            <li key={e.id} className={`tone-${e.error ? "fail" : e.tone} ${e.mine ? "is-mine" : ""}`}>
              <span className="panel-dir" aria-label={e.dir === "in" ? "received" : "sent"}>
                {e.dir === "in" ? "←" : "→"}
              </span>
              <span className="panel-type">{e.label}</span>
              {e.mine && <span className="panel-mine">yours</span>}
              <span className="panel-meta">
                {e.ms !== undefined && <>{fmtMs(e.ms)} · </>}
                {ago(new Date(e.at).toISOString(), now)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <dl className="panel-contract">
        <dt>Listens</dt>
        <dd>{svc.listens.join(", ")}</dd>
        <dt>Emits</dt>
        <dd>{svc.emits.length ? svc.emits.join(", ") : "nothing: the saga ends here"}</dd>
      </dl>
    </div>
  );
}

/**
 * The card's one status line. It always has the same height, so the card never
 * jumps: it shows what the service is doing or just did, in plain words, and
 * falls back to its stats when there is nothing to tell.
 */
function NodeStatus({ id, status, stats }: { id: ServiceId; status: Status | undefined; stats: Stats | undefined }) {
  if (status)
    return (
      <span className="node-status" role="status">
        <span key={status.text} className={`node-status-text tone-${status.tone} ${status.doing ? "is-doing" : ""}`}>
          {status.text}
        </span>
      </span>
    );
  const unit = id === "gateway" ? "requests" : "messages";
  const ms = stats && stats.recent.length > 0 ? Math.round(median(stats.recent)) : undefined;
  return (
    <span className="node-status" title={`${unit} handled since this page opened · median time of the last ${STATS_WINDOW}`}>
      <span key="stats" className="node-status-stats">
        <span>
          <b>{stats?.handled ?? 0}</b> {unit}
        </span>
        <span>{ms === undefined ? "–" : <><b>{ms}</b> ms</>}</span>
      </span>
    </span>
  );
}

/** Moves a dot along an SVG path once, then calls onDone. */
function Traveller({
  path,
  pulse,
  onDone,
}: {
  path: string;
  pulse: Pulse;
  onDone: () => void;
}) {
  const pathRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  useEffect(() => {
    const p = pathRef.current;
    const dot = dotRef.current;
    if (!p || !dot) return;
    if (reducedMotion()) {
      const t = setTimeout(onDone, 900);
      return () => clearTimeout(t);
    }
    const len = p.getTotalLength();
    const duration = pulse.ms;
    let start: number | undefined;
    let raf = 0;
    const tick = (t: number) => {
      start ??= t;
      const k = Math.min(1, (t - start) / duration);
      const eased = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const pt = p.getPointAtLength((pulse.reverse ? 1 - eased : eased) * len);
      dot.setAttribute("cx", String(pt.x));
      dot.setAttribute("cy", String(pt.y));
      if (k < 1) raf = requestAnimationFrame(tick);
      else onDone();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return (
    <g>
      <path ref={pathRef} d={path} fill="none" stroke="none" />
      <circle
        ref={dotRef}
        r={pulse.mine ? 5 : 3}
        className={
          pulse.mine ? `pulse tone-${pulse.tone}` : "pulse pulse-ghost"
        }
        cx={-100}
        cy={-100}
      />
    </g>
  );
}

function PulseEdgeView(props: EdgeProps<PulseEdge>) {
  const { sourceX, sourceY, targetX, targetY, data, id } = props;
  const [, force] = useState(0);
  const done = useRef(new Set<string>());

  const [path, labelX, labelY] = softCurve(
    sourceX,
    sourceY,
    targetX,
    targetY,
    !!data?.vertical,
  );

  const pulses = (data?.pulses ?? []).filter((p) => !done.current.has(p.id));
  const live = [...pulses].reverse().find((p) => p.mine);
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={
          live
            ? `edge edge-live tone-${live.tone}`
            : data?.pathTone
              ? `edge edge-path tone-${data.pathTone}`
              : "edge"
        }
      />
      {pulses.map((p) => (
        <Traveller
          key={p.id}
          path={path}
          pulse={p}
          onDone={() => {
            done.current.add(p.id);
            force((n) => n + 1);
          }}
        />
      ))}
      {/* A route is only named while one of your messages is on it. */}
      {live && (
        <EdgeLabelRenderer>
          <div
            className={`edge-label is-live tone-${live.tone}`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {live.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { service: ServiceNodeView };
const edgeTypes = { pulse: PulseEdgeView };

const POSITIONS: Record<ServiceId, { x: number; y: number }> = {
  gateway: { x: 0, y: 200 },
  order: { x: 360, y: 200 },
  inventory: { x: 820, y: 30 },
  payment: { x: 820, y: 370 },
  notify: { x: 360, y: 450 },
};
// Laptops: the same map, pulled in so it fits beside the order panel.
const TIGHT_POSITIONS: Record<ServiceId, { x: number; y: number }> = {
  gateway: { x: 0, y: 200 },
  order: { x: 320, y: 200 },
  inventory: { x: 700, y: 30 },
  payment: { x: 700, y: 370 },
  notify: { x: 320, y: 450 },
};

// Where each card's detail panel opens: into empty space, away from the lines.
const PANEL_SIDE: Record<ServiceId, Position> = {
  gateway: Position.Bottom,
  order: Position.Top,
  inventory: Position.Bottom,
  payment: Position.Top,
  notify: Position.Right,
};
const PANEL_SIDE_NARROW: Record<ServiceId, Position> = {
  gateway: Position.Bottom,
  order: Position.Bottom,
  inventory: Position.Top,
  payment: Position.Top,
  notify: Position.Top,
};

// Phones: top to bottom, so the nodes stay readable after fit-to-width.
const NARROW_POSITIONS: Record<ServiceId, { x: number; y: number }> = {
  gateway: { x: 130, y: 0 },
  order: { x: 130, y: 160 },
  inventory: { x: 0, y: 340 },
  payment: { x: 260, y: 340 },
  notify: { x: 130, y: 500 },
};

export function useNarrow(query = "(max-width: 720px)") {
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return narrow;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** React Flow reads bare numbers as fractions of the viewport; insets are pixels. */
const px = (i: Insets) =>
  ({
    top: `${i.top}px`,
    right: `${i.right}px`,
    bottom: `${i.bottom}px`,
    left: `${i.left}px`,
  }) as const;

/**
 * Refits the map whenever the floating UI around it changes size. It waits
 * (frame by frame) until React Flow has measured every node, animates the
 * move, then settles with one instant fit so a racing refit can't leave the
 * map zoomed wrong.
 */
function AutoFit({ insets, layout }: { insets: Insets; layout: string }) {
  const { fitView, getNodes, getInternalNode } = useReactFlow();
  const key = `${layout}:${insets.top}:${insets.right}:${insets.bottom}:${insets.left}`;
  useEffect(() => {
    const padding = px(insets);
    const measured = () => {
      const nodes = getNodes();
      return (
        nodes.length > 0 &&
        nodes.every((n) => (getInternalNode(n.id)?.measured?.width ?? 0) > 0)
      );
    };
    let raf = 0;
    let tries = 0;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      if (!measured() && tries++ < 60) {
        raf = requestAnimationFrame(run);
        return;
      }
      // Phones refit instantly: an animated zoom while the panel slides in
      // can leave stale frames on mobile compositors.
      const instant = reducedMotion() || layout === "narrow";
      void fitView({ padding, duration: instant ? 0 : 260 });
      settle = setTimeout(() => void fitView({ padding, duration: 0 }), 320);
    };
    raf = requestAnimationFrame(run);
    const onResize = () => void fitView({ padding, duration: 0 });
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fitView, getNodes, getInternalNode]);
  return null;
}

/** Tone for a line, from the worst message that crossed it (failure > undo > success). */
function pathTones(spans: TraceSpan[]): Partial<Record<EdgeId, Tone>> {
  const rank: Record<Tone, number> = { info: 0, ok: 1, comp: 2, fail: 3 };
  const out: Partial<Record<EdgeId, Tone>> = {};
  let outcome: Tone | undefined;
  for (const s of spans) {
    const route = edgeFor(s);
    if (!route) continue;
    const type = String(s.attributes["messaging.message.type"] ?? "");
    const tone: Tone = type ? toneOf(type) : "ok";
    if (type.startsWith("checkout.evt.order.")) outcome = tone;
    const cur = out[route.edge];
    if (!cur || rank[tone] > rank[cur]) out[route.edge] = tone;
  }
  // The request itself takes the colour of how the order ended.
  out.http = outcome ?? "info";
  for (const k of Object.keys(out) as EdgeId[])
    if (out[k] === "info" && k !== "http") out[k] = "ok";
  return out;
}

interface GraphProps {
  /** With "Your orders" open: the selected order's trace, whose route lights up. */
  pathTraceId?: string | undefined;
  /** Failure lab: services that are down for this visitor. */
  down?: Partial<Record<ServiceId, boolean>>;
  /** Slow mode: messages are held ~1.5 s per hop, so dots travel for longer. */
  slow?: boolean;
  /** Trace ids of the visitor's own orders: their messages are drawn in colour. */
  mine: Set<string>;
  /** Saga state of the order the visitor is looking at, shown under the Order node. */
  focusState?: string | undefined;
  insets: Insets;
}

export function Graph({
  pathTraceId,
  slow = false,
  down = {},
  mine,
  focusState,
  insets,
}: GraphProps) {
  // The selected order's spans: live from the stream, or fetched once when the
  // order is older than what the page has seen.
  useTraceVersion();
  const [fetchedPath, setFetchedPath] = useState<{
    id: string;
    spans: TraceSpan[];
  }>();
  useEffect(() => {
    if (!pathTraceId || traceStore.trace(pathTraceId).length > 0) return;
    let stop = false;
    api
      .trace(pathTraceId)
      .then((spans) => !stop && setFetchedPath({ id: pathTraceId, spans }))
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [pathTraceId]);
  const liveSpans = pathTraceId ? traceStore.trace(pathTraceId) : [];
  const spansForPath =
    liveSpans.length > 0
      ? liveSpans
      : fetchedPath && fetchedPath.id === pathTraceId
        ? fetchedPath.spans
        : [];
  const lit = pathTraceId ? pathTones(spansForPath) : {};
  const litKey = JSON.stringify(lit);
  const [pulses, setPulses] = useState<Record<string, Pulse[]>>({});
  const [flash, setFlash] = useState<Record<string, { n: number; tone: Tone }>>(
    {},
  );
  // Card status lines: the last thing each service finished (shown for a few
  // seconds) and what it started on when your message landed.
  const [done, setDone] = useState<Record<string, Status & { at: number }>>({});
  const [doing, setDoing] = useState<Record<string, { text: string; at: number }>>({});
  const narrow = useNarrow();
  const tight = useNarrow("(max-width: 1320px)");
  const layout = narrow
    ? NARROW_POSITIONS
    : tight
      ? TIGHT_POSITIONS
      : POSITIONS;
  const mineRef = useRef(mine);
  mineRef.current = mine;
  const slowRef = useRef(slow);
  slowRef.current = slow;

  // Your messages in flight to a service: the card spins while one is being
  // worked on, and (failure lab) counts the ones a down service refused. A
  // message is done when that service's processing span (whose parent is the
  // message's publish span) comes back. Counts are always recounted from the
  // pending messages themselves, never kept as running +1/-1 counters.
  type Entry = { dest: ServiceId; arrived: boolean; waiting: boolean; retry: number };
  const pending = useRef(new Map<string, Entry>());
  // Messages a down service refused, per service, with the latest retry number.
  const [waiting, setWaiting] = useState<Record<string, { count: number; retry: number }>>({});
  // Busy: one of your messages has landed and the service hasn't finished it.
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const sync = () => {
    const b: Record<string, boolean> = {};
    const w: Record<string, { count: number; retry: number }> = {};
    for (const e of pending.current.values()) {
      if (!e.arrived) continue;
      if (!e.waiting) {
        b[e.dest] = true;
        continue;
      }
      const cur = (w[e.dest] ??= { count: 0, retry: 0 });
      cur.count++;
      cur.retry = Math.max(cur.retry, e.retry);
    }
    setBusy(b);
    setWaiting(w);
  };
  // Spans come from different services' exporters, so a message's "processed"
  // span can reach the page before its "published" span. Remember recently
  // finished messages so a late publish never starts tracking.
  const finished = useRef(new Set<string>());
  const track = (key: string, dest: ServiceId, travelMs: number, type: string) => {
    if (finished.current.has(key)) return;
    const entry: Entry = { dest, arrived: false, waiting: false, retry: 0 };
    pending.current.set(key, entry);
    setTimeout(() => {
      if (pending.current.get(key) !== entry) return; // finished in flight
      entry.arrived = true;
      sync();
      const text = DOING[type];
      if (text) setDoing((d) => ({ ...d, [dest]: { text, at: Date.now() } }));
      // Safety net: no real step takes this long, so never track forever. A
      // message a down service refused may legitimately wait (lab faults last
      // up to 60 s), so it gets a longer leash.
      const check = (elapsed: number) =>
        setTimeout(() => {
          if (pending.current.get(key) !== entry) return;
          if (entry.waiting && elapsed < 70_000) return check(elapsed + 4000);
          finish(key);
        }, 4000);
      check(4000);
    }, travelMs);
  };
  const finish = (key: string) => {
    finished.current.add(key);
    if (finished.current.size > 500) finished.current.clear();
    if (pending.current.delete(key)) sync();
  };
  /** A down service refused this message; it waits for redelivery instead of finishing. */
  const refuse = (key: string, retry: number) => {
    const entry = pending.current.get(key);
    if (!entry) return;
    entry.waiting = true;
    entry.retry = Math.max(entry.retry, retry);
    sync();
  };

  useEffect(() => {
    const onOwnRequest = () => {
      const pulse: Pulse = {
        id: `local-${Date.now()}`,
        ms: slowRef.current ? SLOW_TRAVEL_MS : 600,
        tone: "info",
        label: "POST /orders",
        mine: true,
      };
      track(pulse.id, "order", pulse.ms, "http");
      setPulses((p) => ({ ...p, http: [...(p.http ?? []).slice(-8), pulse] }));
      setFlash((f) => ({
        ...f,
        gateway: { n: (f.gateway?.n ?? 0) + 1, tone: "info" },
      }));
      // The hop is over when the POST answers (the order service is done with it).
      return () => finish(pulse.id);
    };
    localListeners.add(onOwnRequest);
    return () => void localListeners.delete(onOwnRequest);
  }, []);

  // Live counters for every card, backlog included, so they are not zero on load.
  const [stats, setStats] = useState<Partial<Record<ServiceId, Stats>>>({});
  const [logs, setLogs] = useState<Partial<Record<ServiceId, LogEntry[]>>>({});
  // The card whose detail panel is open. Click a card to toggle it; click the
  // map or press Escape to close.
  const [open, setOpen] = useState<ServiceId | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const closePanel = useMemo(() => () => setOpen(null), []);
  useEffect(
    () =>
      traceStore.subscribe((spans) => {
        const add: Partial<Record<ServiceId, number[]>> = {};
        const logged: Partial<Record<ServiceId, LogEntry[]>> = {};
        for (const s of [...spans].sort((a, b) => a.startMs - b.startMs)) {
          const id = workOf(s);
          if (id) (add[id] ??= []).push(s.durationMs);
          const type = String(s.attributes["messaging.message.type"] ?? "");
          const out = s.kind === "producer" && type && s.service in SERVICES;
          if (!id && !out) continue;
          const svc = (id ?? s.service) as ServiceId;
          (logged[svc] ??= []).push({
            id: s.spanId,
            dir: id ? "in" : "out",
            label: type ? shortType(type) : "POST /orders",
            tone: type ? toneOf(type) : "info",
            at: s.startMs,
            ms: id ? s.durationMs : undefined,
            mine: mineRef.current.has(s.traceId),
            error: s.error,
          });
        }
        if (Object.keys(logged).length > 0)
          setLogs((prev) => {
            const next = { ...prev };
            for (const [k, list] of Object.entries(logged) as [ServiceId, LogEntry[]][])
              next[k] = [...list.reverse(), ...(prev[k] ?? [])].slice(0, LOG_SIZE);
            return next;
          });
        if (Object.keys(add).length === 0) return;
        setStats((prev) => {
          const out = { ...prev };
          for (const [id, ds] of Object.entries(add) as [ServiceId, number[]][]) {
            const cur = prev[id] ?? { handled: 0, recent: [] };
            out[id] = {
              handled: cur.handled + ds.length,
              recent: [...cur.recent, ...ds].slice(-STATS_WINDOW),
            };
          }
          return out;
        });
      }),
    [],
  );

  useEffect(
    () =>
      traceStore.subscribe((spans, live) => {
        if (!live) return;
        const nextPulses: Record<string, Pulse[]> = {};
        const nextFlash: Record<string, Tone> = {};
        const nextDone: Record<string, Status & { at: number }> = {};
        for (const s of [...spans].sort((a, b) => a.startMs - b.startMs)) {
          const isMine = mineRef.current.has(s.traceId);
          const type = String(s.attributes["messaging.message.type"] ?? "");
          const tone = type ? toneOf(type) : "info";
          // Your own HTTP hop was already drawn at click time (announceOwnRequest).
          if (isMine && s.service === "gateway") continue;
          // Any processing span ends the tracking of its message, even if the order
          // has since dropped out of "yours" (only the latest 5 are kept).
          if (s.kind === "consumer" && s.parentSpanId) {
            if (s.attributes["demo.lab.refused"])
              refuse(
                s.parentSpanId,
                Number(s.attributes["messaging.message.delivery_count"] ?? 1),
              );
            else finish(s.parentSpanId);
          }
          // Failure lab moments worth telling on the card.
          if (isMine && s.attributes["demo.lab.crashed"]) {
            nextFlash[s.service] = "fail";
            nextDone[s.service] = { text: "Crashed before ack", tone: "fail", at: Date.now() };
            continue;
          }
          if (isMine && s.attributes["checkout.inbox.duplicate"]) {
            nextFlash[s.service] = "comp";
            nextDone[s.service] = { text: "Duplicate ignored", tone: "comp", at: Date.now() };
            continue;
          }
          if (isMine && s.attributes["demo.lab.refused"]) continue;
          if (isMine && (s.kind === "consumer" || s.kind === "server")) {
            nextFlash[s.service] = tone;
            const told = s.service === "notify" ? NOTIFY_DONE[type] : undefined;
            if (told) nextDone[s.service] = { ...told, at: Date.now() };
          }
          if (isMine && s.kind === "producer" && DONE[type])
            nextDone[s.service] = { ...DONE[type]!, at: Date.now() };
          const route = edgeFor(s);
          const ms =
            isMine && slowRef.current ? SLOW_TRAVEL_MS : isMine ? 900 : 1100;
          if (route && isMine && s.kind === "producer")
            track(s.spanId, destination(route.edge, route.reverse), ms, type);
          if (route)
            (nextPulses[route.edge] ??= []).push({
              id: s.spanId,
              ms,
              tone,
              label: type ? shortType(type) : "POST /orders",
              mine: isMine,
              reverse: route.reverse,
            });
        }
        if (Object.keys(nextFlash).length) {
          setFlash((f) => {
            const out = { ...f };
            for (const [k, tone] of Object.entries(nextFlash))
              out[k] = { n: (f[k]?.n ?? 0) + 1, tone };
            return out;
          });
        }
        if (Object.keys(nextDone).length) setDone((d) => ({ ...d, ...nextDone }));
        if (Object.keys(nextPulses).length) {
          setPulses((p) => {
            const out = { ...p };
            for (const [k, list] of Object.entries(nextPulses))
              out[k] = [...(p[k] ?? []).slice(-8), ...list];
            return out;
          });
        }
      }),
    [],
  );

  // "Done" statuses give way to the stats after a few seconds.
  useEffect(() => {
    const t = setInterval(() => {
      setDone((d) => {
        const now = Date.now();
        const keep = Object.entries(d).filter(([, v]) => now - v.at < DONE_MS);
        return keep.length === Object.keys(d).length ? d : Object.fromEntries(keep);
      });
    }, 500);
    return () => clearInterval(t);
  }, []);

  const computed = useMemo<ServiceNode[]>(
    () =>
      (Object.keys(SERVICES) as ServiceId[]).map((id) => {
        // Refused messages win, then whichever is newer of "just did" and
        // "working on"; the Order card falls back to your order's saga step.
        let status: Status | undefined;
        const w = waiting[id];
        const d = done[id];
        const doingNow = busy[id] ? doing[id] : undefined;
        if (w && w.count > 0)
          status = { text: `Down · ${w.count} waiting, retry #${w.retry}`, tone: "fail" };
        else if (doingNow && (!d || doingNow.at > d.at))
          status = { text: doingNow.text, tone: "info", doing: true };
        else if (d) status = { text: d.text, tone: d.tone };
        else if (id === "order" && focusState && STATE_LABEL[focusState] && focusState !== "CONFIRMED" && focusState !== "CANCELLED")
          status = {
            text: `${STATE_LABEL[focusState]}…`,
            tone: focusState === "RELEASING_STOCK" ? "comp" : "info",
            doing: true,
          };
        return {
          id,
          type: "service",
          position: layout[id],
          draggable: false,
          data: {
            id,
            flash: flash[id]?.n ?? 0,
            tone: flash[id]?.tone ?? "info",
            down: !!down[id],
            busy: !!busy[id],
            waiting: waiting[id],
            status,
            stats: stats[id],
            open: open === id,
            panelSide: (narrow ? PANEL_SIDE_NARROW : PANEL_SIDE)[id],
            onClose: closePanel,
            log: logs[id] ?? [],
          },
        };
      }),
    [
      flash,
      layout,
      done,
      doing,
      focusState,
      waiting,
      busy,
      stats,
      logs,
      open,
      narrow,
      closePanel,
      down.inventory,
      down.payment,
    ],
  );

  // Keep React Flow's own node state (with its measurements) and only patch
  // position and data. Recreating node objects drops the measurements, and
  // React Flow hides a card and its edges until it is measured again.
  const [nodes, setNodes, onNodesChange] = useNodesState<ServiceNode>(computed);
  useEffect(() => {
    setNodes((prev) =>
      computed.map((c) => {
        const p = prev.find((x) => x.id === c.id);
        return p ? { ...p, position: c.position, data: c.data } : c;
      }),
    );
  }, [computed, setNodes]);

  const edges = useMemo<PulseEdge[]>(
    () =>
      EDGES.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: handleId(e.id, narrow ? "narrow" : "wide", "s"),
        targetHandle: handleId(e.id, narrow ? "narrow" : "wide", "t"),
        type: "pulse",
        data: {
          pulses: pulses[e.id] ?? [],
          vertical: narrow,
          pathTone: lit[e.id],
        },
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pulses, narrow, litKey],
  );

  return (
    <div
      className="map"
      aria-label="Live service map. Each moving dot is a message between services."
    >
      <ReactFlow
        key={narrow ? "narrow" : tight ? "tight" : "wide"}
        nodes={nodes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, n) => setOpen((o) => (o === n.id ? null : (n.id as ServiceId)))}
        onPaneClick={() => setOpen(null)}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: px(insets) }}
        minZoom={narrow ? 0.55 : 0.8}
        maxZoom={1.15}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <AutoFit
          insets={insets}
          layout={narrow ? "narrow" : tight ? "tight" : "wide"}
        />
      </ReactFlow>
    </div>
  );
}
