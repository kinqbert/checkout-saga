import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { infraProviders } from "./infra.js";
import { PaymentHandler } from "./payments/payment.handler.js";

@Module({
  controllers: [HealthController],
  providers: [...infraProviders, PaymentHandler],
})
export class AppModule {}
