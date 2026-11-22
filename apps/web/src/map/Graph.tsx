import type { TraceSpan } from "@checkout/contracts";
import { Background, BackgroundVariant, ReactFlow, useNodesState, useReactFlow } from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { traceStore, useTraceVersion } from "../traceStore";
import { EDGES, handleId, PANEL_SIDE, pathTones, POSITIONS, SERVICE_IDS, type ServiceId } from "./model";
import { PulseEdgeView, type PulseEdge } from "./PulseEdge";
import { ServiceNodeView, type ServiceNode } from "./ServiceNode";
import { cardStatus } from "./status";
import { LAPTOP, PHONE, reducedMotion, useMedia } from "./useMedia";
import { useLiveActivity } from "./useLiveActivity";
import { useServiceLog } from "./useServiceLog";

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface GraphProps {
  // the selected order's trace; its route lights up.
  pathTraceId?: string | undefined;
  down?: Partial<Record<ServiceId, boolean>>;
  slow?: boolean;
  mine: Set<string>;
  // the order the Order card falls back to: the one in the panel, else your running one.
  focus?: { state: string; deadlineAt: string | null } | undefined;
  insets: Insets;
}

const nodeTypes = { service: ServiceNodeView };
const edgeTypes = { pulse: PulseEdgeView };

export function Graph({ pathTraceId, slow = false, down = {}, mine, focus, insets }: GraphProps) {
  const phone = useMedia(PHONE);
  const laptop = useMedia(LAPTOP);
  const size = phone ? "narrow" : laptop ? "tight" : "wide";
  const layout = phone ? "narrow" : "wide";

  const { pulses, flash, done, doing, busy, waiting, confetti } = useLiveActivity(mine, slow);
  const { stats, logs } = useServiceLog(mine);
  const pathTone = usePathTones(pathTraceId);
  const now = useDeadlineClock(focus?.deadlineAt);
  const [open, setOpen] = useOpenCard();

  const computed = useMemo<ServiceNode[]>(() => {
    const deadline = focus?.deadlineAt ? Date.parse(focus.deadlineAt) : undefined;
    return SERVICE_IDS.map((id) => ({
      id,
      type: "service",
      position: POSITIONS[size][id],
      draggable: false,
      data: {
        id,
        flash: flash[id]?.n ?? 0,
        tone: flash[id]?.tone ?? "info",
        down: !!down[id],
        busy: !!busy[id],
        status: cardStatus(id, {
          waiting: waiting[id],
          doing: busy[id] ? doing[id] : undefined,
          done: done[id],
          focus: focus && { state: focus.state, deadline },
          now,
        }),
        stats: stats[id],
        confetti: id === "order" ? confetti : 0,
        log: logs[id] ?? [],
        open: open === id,
        panelSide: PANEL_SIDE[layout][id],
        onClose: () => setOpen(null),
      },
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, layout, flash, busy, waiting, doing, done, focus?.state, focus?.deadlineAt, now, stats, confetti, logs, open, down.inventory, down.payment]);

  // patch React Flow's own nodes (they hold measured sizes); new objects hide a card until re-measured.
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
        sourceHandle: handleId(e.id, layout, "s"),
        targetHandle: handleId(e.id, layout, "t"),
        type: "pulse",
        data: { pulses: pulses[e.id] ?? [], vertical: phone, pathTone: pathTone[e.id] },
      })),
    [pulses, layout, phone, pathTone],
  );

  return (
    <div className="map" aria-label="Live service map. Each moving dot is a message between services.">
      <ReactFlow
        key={size}
        nodes={nodes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, n) => setOpen((o) => (o === n.id ? null : (n.id as ServiceId)))}
        onPaneClick={() => setOpen(null)}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: px(insets) }}
        minZoom={phone ? 0.55 : 0.8}
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
        <AutoFit insets={insets} size={size} />
      </ReactFlow>
    </div>
  );
}

function useOpenCard() {
  const [open, setOpen] = useState<ServiceId | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return [open, setOpen] as const;
}

function useDeadlineClock(deadlineAt: string | null | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadlineAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [deadlineAt]);
  return now;
}

// the selected order's route colours; spans come from the stream, or are fetched for older orders.
function usePathTones(traceId: string | undefined) {
  const version = useTraceVersion();
  const [fetched, setFetched] = useState<{ id: string; spans: TraceSpan[] }>();
  useEffect(() => {
    if (!traceId || traceStore.trace(traceId).length > 0) return;
    let stop = false;
    api
      .trace(traceId)
      .then((spans) => !stop && setFetched({ id: traceId, spans }))
      .catch(() => undefined);
    return () => void (stop = true);
  }, [traceId]);
  return useMemo(() => {
    if (!traceId) return {};
    const live = traceStore.trace(traceId);
    return pathTones(live.length > 0 ? live : fetched?.id === traceId ? fetched.spans : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traceId, fetched, version]);
}

// React Flow reads bare numbers as fractions of the viewport.
const px = (i: Insets): Record<keyof Insets, `${number}px`> => ({ top: `${i.top}px`, right: `${i.right}px`, bottom: `${i.bottom}px`, left: `${i.left}px` });

// refits the map when the UI around it changes: waits until every card is measured, then fits.
function AutoFit({ insets, size }: { insets: Insets; size: string }) {
  const { fitView, getNodes, getInternalNode } = useReactFlow();
  const key = `${size}:${insets.top}:${insets.right}:${insets.bottom}:${insets.left}`;
  useEffect(() => {
    const padding = px(insets);
    const measured = () => {
      const nodes = getNodes();
      return nodes.length > 0 && nodes.every((n) => (getInternalNode(n.id)?.measured?.width ?? 0) > 0);
    };
    let raf = 0;
    let tries = 0;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      if (!measured() && tries++ < 60) {
        raf = requestAnimationFrame(run);
        return;
      }
      // animated zooms leave stale frames on mobile compositors.
      const instant = reducedMotion() || size === "narrow";
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
