import { Module } from "@nestjs/common";
import { LabFaults } from "@checkout/messaging";
import { HealthController } from "./health.controller.js";
import { LabController } from "./lab.controller.js";
import { infraProviders } from "./infra.js";
import { PaymentHandler } from "./payments/payment.handler.js";

@Module({
  controllers: [LabController, HealthController],
  providers: [...infraProviders, { provide: LabFaults, useValue: new LabFaults() }, PaymentHandler],
})
export class AppModule {}
