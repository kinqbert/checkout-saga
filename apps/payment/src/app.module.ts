import { Module } from "@nestjs/common";
import { LabController, LabFaults } from "@checkout/messaging";
import { HealthController } from "./health.controller.js";
import { infraProviders } from "./infra.js";
import { PaymentHandler } from "./payments/payment.handler.js";

@Module({
  controllers: [LabController, HealthController],
  providers: [...infraProviders, { provide: LabFaults, useValue: new LabFaults() }, PaymentHandler],
})
export class AppModule {}
