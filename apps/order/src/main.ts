import { startTelemetry } from "@checkout/telemetry";
import "reflect-metadata";
import { bootstrap } from "./bootstrap.js";

startTelemetry("order");
await bootstrap(Number(process.env.PORT ?? 3001));
