import { LAB_FAULTS, LabCooldownError, LabFaults, type LabSnapshot } from "@checkout/messaging";
import { BadRequestException, Body, Controller, Get, HttpException, HttpStatus, Param, ParseUUIDPipe, Put } from "@nestjs/common";
import * as z from "zod";

const FaultChange = z.object({ fault: z.enum(LAB_FAULTS), on: z.boolean() });

/** Failure-lab switches for this service, per visitor lab id (internal; the gateway proxies it). */
@Controller("lab")
export class LabController {
  constructor(private readonly faults: LabFaults) {}

  @Get(":lab")
  get(@Param("lab", new ParseUUIDPipe()) lab: string): LabSnapshot {
    return this.faults.snapshot(lab);
  }

  @Put(":lab")
  set(@Param("lab", new ParseUUIDPipe()) lab: string, @Body() body: unknown): LabSnapshot {
    const parsed = FaultChange.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ error: `expected { fault: ${LAB_FAULTS.join(" | ")}, on: boolean }` });
    try {
      return this.faults.set(lab, parsed.data.fault, parsed.data.on);
    } catch (err) {
      if (err instanceof LabCooldownError) throw new HttpException({ error: err.message }, HttpStatus.TOO_MANY_REQUESTS);
      throw err;
    }
  }
}
