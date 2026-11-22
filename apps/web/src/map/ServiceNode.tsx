import { Handle, NodeToolbar, type Node, type NodeProps, type Position } from "@xyflow/react";
import { memo, useEffect, useRef, useState } from "react";
import { confettiIn } from "../confetti";
import { ago, ms as fmtMs, type Tone } from "../format";
import { anchorsFor, SERVICES, type ServiceId } from "./model";
import type { Status } from "./status";
import { STATS_WINDOW, type LogEntry, type Stats } from "./useServiceLog";

export type ServiceNode = Node<
  {
    id: ServiceId;
    // bumps to flash the card's ring
    flash: number;
    tone: Tone;
    down: boolean;
    busy: boolean;
    status: Status | undefined;
    stats: Stats | undefined;
    // bumps to throw confetti
    confetti: number;
    log: LogEntry[];
    open: boolean;
    panelSide: Position;
    onClose: () => void;
  },
  "service"
>;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

export const ServiceNodeView = memo(function ServiceNodeView({ data }: NodeProps<ServiceNode>) {
  const svc = SERVICES[data.id];
  return (
    <div
      className={`node node-${data.id} ${data.down ? "is-down" : ""} ${data.open ? "is-open" : ""}`}
      aria-expanded={data.open}
      title={data.open ? undefined : `Show recent events at ${svc.label}`}
    >
      {data.confetti > 0 && <Confetti key={data.confetti} />}
      {data.flash > 0 && <span key={data.flash} className={`node-ring tone-${data.tone}`} />}
      {anchorsFor(data.id).map((a) => (
        <Handle key={a.id} id={a.id} type={a.type} position={a.position} style={a.style} isConnectable={false} />
      ))}
      <span className="node-head">
        <span className="node-title">
          <svc.Icon className="node-icon" width={16} height={16} />
          <span className="node-name">{svc.label}</span>
        </span>
        {data.down ? (
          <span className="node-down">Down</span>
        ) : (
          <span className={`node-spinner ${data.busy ? "is-on" : ""}`} role="status" aria-label={data.busy ? `${svc.label} is working` : undefined} />
        )}
      </span>
      <span className="node-role">{svc.role}</span>
      <StatusLine id={data.id} status={data.status} stats={data.stats} />
      <NodeToolbar isVisible={data.open} position={data.panelSide} offset={12}>
        <Panel id={data.id} log={data.log} onClose={data.onClose} />
      </NodeToolbar>
    </div>
  );
});

// fixed height, so the card never jumps: a status, else the stats.
function StatusLine({ id, status, stats }: { id: ServiceId; status: Status | undefined; stats: Stats | undefined }) {
  if (status)
    return (
      <span className="node-status" role="status">
        <span key={status.id ?? status.text} className={`node-status-text tone-${status.tone} ${status.doing ? "is-doing" : ""}`}>
          {status.text}
        </span>
      </span>
    );
  const unit = id === "gateway" ? "requests" : "messages";
  const typical = stats?.recent.length ? Math.round(median(stats.recent)) : undefined;
  return (
    <span className="node-status" title={`${unit} handled since this page opened · median time of the last ${STATS_WINDOW}`}>
      <span key="stats" className="node-status-stats">
        <span>
          <b>{stats?.handled ?? 0}</b> {unit}
        </span>
        <span>{typical === undefined ? "–" : <><b>{typical}</b> ms</>}</span>
      </span>
    </span>
  );
}

function Panel({ id, log, onClose }: { id: ServiceId; log: LogEntry[]; onClose: () => void }) {
  const svc = SERVICES[id];
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="node-panel nodrag nopan" role="dialog" aria-label={`Recent events at ${svc.label}`} onClick={(e) => e.stopPropagation()}>
      <div className="node-panel-head">
        <span>Recent at {svc.label}</span>
        <button className="node-panel-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {log.length === 0 ? (
        <p className="node-panel-empty">Nothing yet. Place an order and watch it land here.</p>
      ) : (
        <ul className="node-panel-log">
          {log.map((e) => (
            <li key={e.id} className={`tone-${e.error ? "fail" : e.tone} ${e.mine ? "is-mine" : ""}`}>
              <span className="node-panel-dir" aria-label={e.dir === "in" ? "received" : "sent"}>
                {e.dir === "in" ? "←" : "→"}
              </span>
              <span className="node-panel-type">{e.label}</span>
              {e.mine && <span className="node-panel-mine">yours</span>}
              <span className="node-panel-meta">
                {e.ms !== undefined && <>{fmtMs(e.ms)} · </>}
                {ago(new Date(e.at).toISOString(), now)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <dl className="node-panel-contract">
        <dt>Listens</dt>
        <dd>{svc.listens.join(", ")}</dd>
        <dt>Emits</dt>
        <dd>{svc.emits.length ? svc.emits.join(", ") : "nothing: the saga ends here"}</dd>
      </dl>
    </div>
  );
}

function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => (ref.current ? confettiIn(ref.current) : undefined), []);
  return <canvas ref={ref} className="node-confetti" aria-hidden="true" />;
}
