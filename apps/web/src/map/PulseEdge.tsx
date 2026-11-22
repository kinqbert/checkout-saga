import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import type { Tone } from "../format";
import { reducedMotion } from "./useMedia";

export interface Pulse {
  id: string;
  ms: number;
  tone: Tone;
  label: string;
  mine: boolean;
}

export type PulseEdge = Edge<{ pulses: Pulse[]; vertical: boolean; pathTone?: Tone | undefined }, "pulse">;

// a gentle S-curve (control points 15% in); returns the path and its midpoint.
function curve(sx: number, sy: number, tx: number, ty: number, vertical: boolean): [string, number, number] {
  const k = 0.15;
  const c = vertical
    ? `C ${sx},${sy + (ty - sy) * k} ${tx},${ty - (ty - sy) * k}`
    : `C ${sx + (tx - sx) * k},${sy} ${tx - (tx - sx) * k},${ty}`;
  return [`M ${sx},${sy} ${c} ${tx},${ty}`, (sx + tx) / 2, (sy + ty) / 2];
}

function Traveller({ path, pulse, onDone }: { path: string; pulse: Pulse; onDone: () => void }) {
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
    let start: number | undefined;
    let raf = 0;
    const tick = (t: number) => {
      start ??= t;
      const k = Math.min(1, (t - start) / pulse.ms);
      const eased = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const pt = p.getPointAtLength(eased * len);
      dot.setAttribute("cx", String(pt.x));
      dot.setAttribute("cy", String(pt.y));
      if (k < 1) raf = requestAnimationFrame(tick);
      else onDone();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // once per dot: a re-render mid-flight must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return (
    <g>
      <path ref={pathRef} d={path} fill="none" stroke="none" />
      <circle ref={dotRef} r={pulse.mine ? 5 : 3} className={pulse.mine ? `pulse tone-${pulse.tone}` : "pulse pulse-ghost"} cx={-100} cy={-100} />
    </g>
  );
}

export function PulseEdgeView({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<PulseEdge>) {
  const [, rerender] = useState(0);
  const landed = useRef(new Set<string>());
  const [path, labelX, labelY] = curve(sourceX, sourceY, targetX, targetY, !!data?.vertical);

  const pulses = (data?.pulses ?? []).filter((p) => !landed.current.has(p.id));
  const live = pulses.findLast((p) => p.mine);
  const className = live ? `edge edge-live tone-${live.tone}` : data?.pathTone ? `edge edge-path tone-${data.pathTone}` : "edge";
  return (
    <>
      <BaseEdge id={id} path={path} className={className} />
      {pulses.map((p) => (
        <Traveller
          key={p.id}
          path={path}
          pulse={p}
          onDone={() => {
            landed.current.add(p.id);
            rerender((n) => n + 1);
          }}
        />
      ))}
      {/* a line is only named while one of your messages is on it. */}
      {live && (
        <EdgeLabelRenderer>
          <div className={`edge-label is-live tone-${live.tone}`} style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            {live.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
