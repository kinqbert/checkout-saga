import { Module } from "@nestjs/common";
import { LabFaults } from "@checkout/messaging";
import { CatalogConsumer } from "./catalog/catalog.consumer.js";
import { HealthController } from "./health.controller.js";
import { infraProviders } from "./infra.js";
import { LabController } from "./lab.controller.js";
import { OrdersController } from "./orders/orders.controller.js";
import { OrdersService } from "./orders/orders.service.js";
import { SagaRunner } from "./saga/saga.runner.js";
import { SagaTimeouts } from "./saga/saga.timeouts.js";

@Module({
  controllers: [LabController, OrdersController, HealthController],
  providers: [
    ...infraProviders,
    { provide: LabFaults, useValue: new LabFaults() },
    OrdersService,
    SagaRunner,
    SagaTimeouts,
    CatalogConsumer,
  ],
})
export class AppModule {}
