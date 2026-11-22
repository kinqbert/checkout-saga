import { httpTracing } from "@checkout/telemetry";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

export async function bootstrap(port: number) {
  const app = await NestFactory.create(AppModule, { logger: ["log", "warn", "error"] });
  app.use(httpTracing({ continueOnly: true }));
  app.enableShutdownHooks([], { useProcessExit: true });
  await app.listen(port, "0.0.0.0");
}
