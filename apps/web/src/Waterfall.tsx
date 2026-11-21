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
  const end = Math.max(...spans.map((s) => s.startMs + s.durationMs));
  const total = Math.max(1, end - t0);

  return (
    <div className="waterfall" role="table" aria-label="trace spans">
      <div className="wf-head">
        <span>{spans.length} spans across {new Set(spans.map((s) => s.service)).size} services</span>
        <span>{ms(total)} end to end</span>
      </div>
      {sorted.map((s) => {
        const left = ((s.startMs - t0) / total) * 100;
        const width = Math.max(0.6, (s.durationMs / total) * 100);
        return (
          <div key={s.spanId} className="wf-row" role="row" title={`${s.service} · ${s.name} · ${ms(s.durationMs)}`}>
            <div className="wf-name" style={{ paddingLeft: `${Math.min(depth(s), 8) * 10}px` }}>
              <i className={`svc-chip svc-${s.service}`} />
              <span className="wf-svc">{s.service}</span>
              <span className="wf-op">{s.name}</span>
            </div>
            <div className="wf-track">
              <div className={`wf-bar svc-bg-${s.service} ${s.error ? "is-error" : ""}`} style={{ left: `${left}%`, width: `${width}%` }} />
            </div>
            <div className="wf-dur">{ms(s.durationMs)}</div>
          </div>
        );
      })}
    </div>
  );
}
