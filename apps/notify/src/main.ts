import { startTelemetry } from "@checkout/telemetry";
import "reflect-metadata";
import { bootstrap } from "./bootstrap.js";

startTelemetry("notify");
await bootstrap(Number(process.env.PORT ?? 3004));
