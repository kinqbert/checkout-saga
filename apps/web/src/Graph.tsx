import type { TraceSpan } from "@checkout/contracts";
import {
  Background,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { shortType, toneOf, type Tone } from "./format";
import { traceStore } from "./traceStore";

export type ServiceId = "gateway" | "order" | "inventory" | "payment" | "notify";

export const SERVICES: Record<ServiceId, { label: string; role: string }> = {
  gateway: { label: "Gateway", role: "HTTP API" },
  order: { label: "Order", role: "saga orchestrator" },
  inventory: { label: "Inventory", role: "stock · catalog owner" },
  payment: { label: "Payment", role: "fake card provider" },
  notify: { label: "Notify", role: "e-mails, outside the saga" },
};

type EdgeId = "http" | "reserve" | "stockEvt" | "capture" | "payEvt" | "outcome";

type Side = "l" | "r" | "t" | "b";

/** sh/th: handle sides on the wide layout; nsh/nth: on the narrow (phone) layout. */
const EDGES: { id: EdgeId; source: ServiceId; target: ServiceId; sh: Side; th: Side; nsh: Side; nth: Side; label: string }[] = [
  { id: "http", source: "gateway", target: "order", sh: "r", th: "l", nsh: "b", nth: "t", label: "POST /orders" },
  { id: "reserve", source: "order", target: "inventory", sh: "r", th: "l", nsh: "l", nth: "t", label: "reserve · release" },
  { id: "stockEvt", source: "inventory", target: "order", sh: "l", th: "r", nsh: "t", nth: "l", label: "reserved · rejected · released" },
  { id: "capture", source: "order", target: "payment", sh: "r", th: "l", nsh: "r", nth: "t", label: "capture" },
  { id: "payEvt", source: "payment", target: "order", sh: "l", th: "r", nsh: "t", nth: "r", label: "captured · failed" },
  { id: "outcome", source: "order", target: "notify", sh: "b", th: "t", nsh: "b", nth: "t", label: "confirmed · cancelled" },
];

/** Which arrow a span travels along, based on what it published or called. */
function edgeFor(span: TraceSpan): EdgeId | undefined {
  if (span.kind === "client" && span.service === "gateway" && span.attributes["peer.service"] === "order" && span.name.startsWith("POST"))
    return "http";
  if (span.kind !== "producer") return undefined;
  const type = String(span.attributes["messaging.message.type"] ?? "");
  if (type.startsWith("checkout.cmd.inventory.")) return "reserve";
  if (type.startsWith("checkout.evt.inventory.") || type.startsWith("catalog.")) return "stockEvt";
  if (type.startsWith("checkout.cmd.payment.")) return "capture";
  if (type.startsWith("checkout.evt.payment.")) return "payEvt";
  if (type.startsWith("checkout.evt.order.")) return "outcome";
  return undefined;
}

interface Pulse {
  id: string;
  tone: Tone;
  label: string;
}

type ServiceNodeData = { id: ServiceId; flash: number; handled: number; tone: Tone };
type ServiceNode = Node<ServiceNodeData, "service">;
type PulseEdgeData = { label: string; pulses: Pulse[]; offset: number };
type PulseEdge = Edge<PulseEdgeData, "pulse">;

const sides = [
  { id: "l", pos: Position.Left },
  { id: "r", pos: Position.Right },
  { id: "t", pos: Position.Top },
  { id: "b", pos: Position.Bottom },
] as const;

const ServiceNodeView = memo(function ServiceNodeView({ data }: NodeProps<ServiceNode>) {
  const svc = SERVICES[data.id];
  return (
    <div className={`svc svc-${data.id}`}>
      {data.flash > 0 && <span key={data.flash} className={`svc-flash tone-${data.tone}`} />}
      {sides.map((s) => (
        <Handle key={`${s.id}-s`} id={`${s.id}-s`} type="source" position={s.pos} isConnectable={false} />
      ))}
      {sides.map((s) => (
        <Handle key={`${s.id}-t`} id={`${s.id}-t`} type="target" position={s.pos} isConnectable={false} />
      ))}
      <div className="svc-dot" />
      <div>
        <div className="svc-name">{svc.label}</div>
        <div className="svc-role">{svc.role}</div>
      </div>
      <div className="svc-count" title="spans handled since you opened the page">
        {data.handled}
      </div>
    </div>
  );
});

/** Moves a dot along an SVG path once, then calls onDone. */
function Traveller({ path, tone, onDone }: { path: string; tone: Tone; onDone: () => void }) {
  const pathRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  useEffect(() => {
    const p = pathRef.current;
    const dot = dotRef.current;
    if (!p || !dot) return;
    const len = p.getTotalLength();
    const duration = 900;
    let start: number | undefined;
    let raf = 0;
    const tick = (t: number) => {
      start ??= t;
      const k = Math.min(1, (t - start) / duration);
      const eased = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const pt = p.getPointAtLength(eased * len);
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
      <circle ref={dotRef} r={6} className={`pulse-dot tone-${tone}`} cx={-100} cy={-100} />
    </g>
  );
}

function PulseEdgeView(props: EdgeProps<PulseEdge>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, id } = props;
  const [, force] = useState(0);
  const done = useRef(new Set<string>());

  // Shift both ends sideways so the two directions between a pair don't overlap.
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.hypot(dx, dy) || 1;
  const off = data?.offset ?? 0;
  const nx = (-dy / len) * off;
  const ny = (dx / len) * off;
  const [path, labelX, labelY] = getBezierPath({
    sourceX: sourceX + nx,
    sourceY: sourceY + ny,
    targetX: targetX + nx,
    targetY: targetY + ny,
    sourcePosition,
    targetPosition,
  });

  const pulses = (data?.pulses ?? []).filter((p) => !done.current.has(p.id));
  const latest = pulses[pulses.length - 1];
  return (
    <>
      <BaseEdge id={id} path={path} className={latest ? `edge-active tone-${latest.tone}` : "edge-idle"} markerEnd={props.markerEnd} />
      {pulses.map((p) => (
        <Traveller
          key={p.id}
          path={path}
          tone={p.tone}
          onDone={() => {
            done.current.add(p.id);
            force((n) => n + 1);
          }}
        />
      ))}
      <EdgeLabelRenderer>
        <div
          className={`edge-label ${latest ? `is-live tone-${latest.tone}` : ""}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX + nx * 1.6}px, ${labelY + ny * 1.6}px)` }}
        >
          {latest ? latest.label : data?.label}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { service: ServiceNodeView };
const edgeTypes = { pulse: PulseEdgeView };

const POSITIONS: Record<ServiceId, { x: number; y: number }> = {
  gateway: { x: 0, y: 190 },
  order: { x: 330, y: 190 },
  inventory: { x: 680, y: 40 },
  payment: { x: 680, y: 340 },
  notify: { x: 330, y: 420 },
};

// Phones: top-to-bottom, so the nodes stay readable after fit-to-width.
const NARROW_POSITIONS: Record<ServiceId, { x: number; y: number }> = {
  gateway: { x: 120, y: 0 },
  order: { x: 120, y: 150 },
  inventory: { x: 0, y: 330 },
  payment: { x: 240, y: 330 },
  notify: { x: 120, y: 480 },
};

function useNarrow(query = "(max-width: 640px)") {
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return narrow;
}

export function Graph() {
  const [pulses, setPulses] = useState<Record<string, Pulse[]>>({});
  const [flash, setFlash] = useState<Record<string, { n: number; tone: Tone }>>({});
  const [handled, setHandled] = useState<Record<string, number>>({});
  const narrow = useNarrow();

  useEffect(
    () =>
      traceStore.subscribe((spans, live) => {
        if (!live) return;
        const nextPulses: Record<string, Pulse[]> = {};
        const nextFlash: Record<string, Tone> = {};
        const counts: Record<string, number> = {};
        for (const s of [...spans].sort((a, b) => a.startMs - b.startMs)) {
          counts[s.service] = (counts[s.service] ?? 0) + 1;
          const type = String(s.attributes["messaging.message.type"] ?? "");
          if (s.kind === "consumer" || s.kind === "server") nextFlash[s.service] = type ? toneOf(type) : "info";
          const edge = edgeFor(s);
          if (edge) {
            (nextPulses[edge] ??= []).push({
              id: s.spanId,
              tone: type ? toneOf(type) : "info",
              label: type ? shortType(type) : "POST /orders",
            });
          }
        }
        setHandled((h) => {
          const out = { ...h };
          for (const [k, v] of Object.entries(counts)) out[k] = (out[k] ?? 0) + v;
          return out;
        });
        if (Object.keys(nextFlash).length) {
          setFlash((f) => {
            const out = { ...f };
            for (const [k, tone] of Object.entries(nextFlash)) out[k] = { n: (f[k]?.n ?? 0) + 1, tone };
            return out;
          });
        }
        if (Object.keys(nextPulses).length) {
          setPulses((p) => {
            const out = { ...p };
            for (const [k, list] of Object.entries(nextPulses)) out[k] = [...(p[k] ?? []).slice(-6), ...list];
            return out;
          });
        }
      }),
    [],
  );

  const nodes = useMemo<ServiceNode[]>(
    () =>
      (Object.keys(SERVICES) as ServiceId[]).map((id) => ({
        id,
        type: "service",
        position: (narrow ? NARROW_POSITIONS : POSITIONS)[id],
        draggable: false,
        data: { id, flash: flash[id]?.n ?? 0, tone: flash[id]?.tone ?? "info", handled: handled[id] ?? 0 },
      })),
    [flash, handled, narrow],
  );

  const edges = useMemo<PulseEdge[]>(
    () =>
      EDGES.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: `${narrow ? e.nsh : e.sh}-s`,
        targetHandle: `${narrow ? e.nth : e.th}-t`,
        type: "pulse",
        data: { label: e.label, pulses: pulses[e.id] ?? [], offset: e.id === "http" || e.id === "outcome" ? 0 : 10 },
      })),
    [pulses, narrow],
  );

  return (
    <div className="graph">
      <ReactFlow
        key={narrow ? "narrow" : "wide"}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: narrow ? 0.06 : 0.12 }}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={22} size={1} />
      </ReactFlow>
      <div className="graph-legend">
        <span><i className="tone-ok" /> success</span>
        <span><i className="tone-fail" /> failure</span>
        <span><i className="tone-comp" /> compensation</span>
        <span className="muted">arrows go through NATS JetStream</span>
      </div>
    </div>
  );
}
