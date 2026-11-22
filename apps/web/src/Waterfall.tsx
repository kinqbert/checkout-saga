import type { TraceSpan } from "@checkout/contracts";
import { ms } from "./format";

/** Spans of one trace as a timeline, nested by parent. */
export function Waterfall({ spans }: { spans: TraceSpan[] }) {
  if (spans.length === 0) return <p className="muted small">Waiting for spans…</p>;

  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const depth = (s: TraceSpan): number => {
    let d = 0;
    let cur = s;
    while (cur.parentSpanId && byId.has(cur.parentSpanId) && d < 30) {
      cur = byId.get(cur.parentSpanId)!;
      d++;
    }
    return d;
  };
  const sorted = [...spans].sort((a, b) => a.startMs - b.startMs || depth(a) - depth(b));
  const t0 = sorted[0]!.startMs;
  const total = Math.max(1, Math.max(...spans.map((s) => s.startMs + s.durationMs)) - t0);

  return (
    <ol className="wf" aria-label="Spans in this trace">
      {sorted.map((s) => (
        <li key={s.spanId} className="wf-row" style={{ paddingLeft: `${Math.min(depth(s), 8) * 6}px` }}>
          <span className="wf-name">
            <span className={`wf-svc ${s.service === "order" ? "is-order" : ""}`}>{s.service}</span>
            <span className="wf-op">{s.name.replace(/checkout\.(cmd|evt)\./, "")}</span>
          </span>
          <span className="wf-track">
            <span
              className={`wf-bar ${s.service === "order" ? "is-order" : ""} ${s.error ? "is-error" : ""}`}
              style={{ left: `${((s.startMs - t0) / total) * 100}%`, width: `${Math.max(0.8, (s.durationMs / total) * 100)}%` }}
            />
          </span>
          <span className="wf-dur num">{ms(s.durationMs)}</span>
        </li>
      ))}
    </ol>
  );
}
