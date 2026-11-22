// per-visitor faults: orders carry `demo.lab=<id>` in baggage and only that visitor's messages
// misbehave (except "kill", a real restart). Faults expire on their own.
export const LAB_FAULTS = ["down", "slow", "crash", "kill"] as const;
export type LabFault = (typeof LAB_FAULTS)[number];

export const LAB_FAULT_TTL_MS = 60_000;

// a kill restarts the process for everyone, so it's rate limited across all labs.
export const KILL_COOLDOWN_MS = Number(process.env.LAB_KILL_COOLDOWN_MS ?? 30_000);

export class LabCooldownError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`Order was restarted moments ago. Try again in ${retryAfterSeconds}s.`);
  }
}

export interface LabSnapshot {
  downUntil: string | null;
  slowUntil: string | null;
  crashArmed: boolean;
  killArmed: boolean;
}

export class LabFaults {
  private readonly labs = new Map<string, Partial<Record<LabFault, number>>>();
  // starts at boot: a kill restarts the process, so a restart counts as one.
  private lastKillArmed = Date.now();

  set(lab: string, fault: LabFault, on: boolean): LabSnapshot {
    if (fault === "kill" && on) {
      const wait = this.lastKillArmed + KILL_COOLDOWN_MS - Date.now();
      if (wait > 0) throw new LabCooldownError(Math.ceil(wait / 1000));
      this.lastKillArmed = Date.now();
    }
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

  takeCrash(lab: string): boolean {
    return this.take(lab, "crash");
  }

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
