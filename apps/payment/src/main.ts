import { startTelemetry } from "@checkout/telemetry";
import "reflect-metadata";
import { bootstrap } from "./bootstrap.js";

startTelemetry("payment");
await bootstrap(Number(process.env.PORT ?? 3003));
