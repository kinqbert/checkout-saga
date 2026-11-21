import { Module } from "@nestjs/common";
import { CatalogConsumer } from "./catalog/catalog.consumer.js";
import { HealthController } from "./health.controller.js";
import { infraProviders } from "./infra.js";
import { OrdersController } from "./orders/orders.controller.js";
import { OrdersService } from "./orders/orders.service.js";
import { SagaRunner } from "./saga/saga.runner.js";

@Module({
  controllers: [OrdersController, HealthController],
  providers: [...infraProviders, OrdersService, SagaRunner, CatalogConsumer],
})
export class AppModule {}
