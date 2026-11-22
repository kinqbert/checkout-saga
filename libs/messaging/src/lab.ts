/**
 * Failure lab: per-visitor fault switches, owned by the service they break.
 *
 * A visitor's orders carry `demo.lab=<id>` in W3C baggage. When that lab has
 * a fault switched on here, the service misbehaves for those messages only;
 * every other visitor's traffic is untouched (except "kill", which really
 * restarts the process). Faults expire on their own, so nothing stays broken
 * after a visitor leaves.
 *
 * - down:  refuse the visitor's messages (they are redelivered every second)
 * - slow:  the external provider answers only after the order's deadline
 * - crash: one-shot; commit the work, then "crash" before acking
 * - kill:  one-shot; finish and ack the step, then really exit the process
 */
export const LAB_FAULTS = ["down", "slow", "crash", "kill"] as const;
export type LabFault = (typeof LAB_FAULTS)[number];

export const LAB_FAULT_TTL_MS = 60_000;

export interface LabSnapshot {
  /** ISO time the outage ends on its own, or null when the service is up */
  downUntil: string | null;
  /** ISO time the slow provider is fast again, or null */
  slowUntil: string | null;
  /** the next message handled will "crash" before it is acknowledged */
  crashArmed: boolean;
  /** the process exits right after the next message is handled */
  killArmed: boolean;
}

export class LabFaults {
  private readonly labs = new Map<string, Partial<Record<LabFault, number>>>();

  set(lab: string, fault: LabFault, on: boolean): LabSnapshot {
    const entry = this.labs.get(lab) ?? {};
    if (on) entry[fault] = Date.now() + LAB_FAULT_TTL_MS;
    else delete entry[fault];
    this.labs.set(lab, entry);
    if (this.labs.size > 10_000) this.labs.clear();
    return this.snapshot(lab);
  }

  snapshot(lab: string): LabSnapshot {
    const until = (f: LabFault) => this.until(lab, f);
    const iso = (t: number | undefined) => (t ? new Date(t).toISOString() : null);
    return {
      downUntil: iso(until("down")),
      slowUntil: iso(until("slow")),
      crashArmed: until("crash") !== undefined,
      killArmed: until("kill") !== undefined,
    };
  }

  isDown(lab: string): boolean {
    return this.until(lab, "down") !== undefined;
  }

  isSlow(lab: string): boolean {
    return this.until(lab, "slow") !== undefined;
  }

  /** One-shot: true once if a crash is armed for this lab, then disarms. */
  takeCrash(lab: string): boolean {
    return this.take(lab, "crash");
  }

  /** One-shot: true once if a kill is armed for this lab, then disarms. */
  takeKill(lab: string): boolean {
    return this.take(lab, "kill");
  }

  private until(lab: string, fault: LabFault): number | undefined {
    const t = this.labs.get(lab)?.[fault];
    return t && t > Date.now() ? t : undefined;
  }

  private take(lab: string, fault: LabFault): boolean {
    if (this.until(lab, fault) === undefined) return false;
    delete this.labs.get(lab)![fault];
    return true;
  }
}
