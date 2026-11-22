/**
 * Failure lab: per-visitor fault switches, owned by the service they break.
 *
 * A visitor's orders carry `demo.lab=<id>` in W3C baggage. When that lab has
 * a fault switched on here, the consumer runner misbehaves for those messages
 * only; every other visitor's traffic is untouched. Faults expire on their
 * own, so nothing stays broken after a visitor leaves.
 */
export type LabFault = "down" | "crash";

export const LAB_FAULT_TTL_MS = 60_000;

export interface LabSnapshot {
  /** ISO time the outage ends on its own, or null when the service is up */
  downUntil: string | null;
  /** the next message handled will "crash" before it is acknowledged */
  crashArmed: boolean;
}

export class LabFaults {
  private readonly labs = new Map<string, { downUntil?: number; crashUntil?: number }>();

  set(lab: string, fault: LabFault, on: boolean): LabSnapshot {
    const entry = this.labs.get(lab) ?? {};
    const until = on ? Date.now() + LAB_FAULT_TTL_MS : undefined;
    if (fault === "down") entry.downUntil = until;
    else entry.crashUntil = until;
    this.labs.set(lab, entry);
    if (this.labs.size > 10_000) this.labs.clear();
    return this.snapshot(lab);
  }

  snapshot(lab: string): LabSnapshot {
    const e = this.labs.get(lab);
    const now = Date.now();
    const down = e?.downUntil && e.downUntil > now ? e.downUntil : undefined;
    return {
      downUntil: down ? new Date(down).toISOString() : null,
      crashArmed: !!(e?.crashUntil && e.crashUntil > now),
    };
  }

  isDown(lab: string): boolean {
    return this.snapshot(lab).downUntil !== null;
  }

  /** One-shot: true once if a crash is armed for this lab, then disarms. */
  takeCrash(lab: string): boolean {
    const e = this.labs.get(lab);
    if (!e?.crashUntil || e.crashUntil <= Date.now()) return false;
    e.crashUntil = undefined;
    return true;
  }
}
