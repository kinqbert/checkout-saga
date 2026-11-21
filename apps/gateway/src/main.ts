import { httpTracing, startTelemetry } from "@checkout/telemetry";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { AppModule } from "./app.module.js";

startTelemetry("gateway");

const app = await NestFactory.create<NestExpressApplication>(AppModule, {
  logger: ["log", "warn", "error"],
});
app.set("trust proxy", "loopback, linklocal, uniquelocal");
app.disable("x-powered-by");
app.use(
  httpTracing({
    // Only API writes start traces: reads are the UI polling, and would drown the
    // interesting traces (a checkout) in noise.
    ignore: (path, method) => !path.startsWith("/api/") || method === "GET",
  }),
);

// Serves the built web UI, with a fallback to index.html for client routes.
const webDist = process.env.WEB_DIST ?? resolve(import.meta.dirname, "../../web/dist");
if (existsSync(webDist)) {
  app.useStaticAssets(webDist, { index: "index.html", maxAge: "1h" });
  app.use((req: { method: string; path: string }, res: { sendFile(p: string): void }, next: () => void) => {
    if (req.method === "GET" && !req.path.startsWith("/api") && req.path !== "/healthz") {
      return res.sendFile(resolve(webDist, "index.html"));
    }
    next();
  });
}

app.enableShutdownHooks([], { useProcessExit: true });
await app.listen(Number(process.env.PORT ?? 8080), "0.0.0.0");
