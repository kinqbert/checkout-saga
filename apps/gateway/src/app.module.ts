import { Module } from "@nestjs/common";
import { ApiController } from "./api.controller.js";
import { HealthController } from "./health.controller.js";
import { Upstream } from "./upstream.js";

@Module({
  controllers: [ApiController, HealthController],
  providers: [Upstream],
})
export class AppModule {}
