import { Module } from "@nestjs/common";
import { LabFaults } from "@checkout/messaging";
import { HealthController } from "./health.controller.js";
import { LabController } from "./lab.controller.js";
import { infraProviders } from "./infra.js";
import { ProductsController } from "./products/products.controller.js";
import { ProductsService } from "./products/products.service.js";
import { StockHandler } from "./stock/stock.handler.js";

@Module({
  controllers: [LabController, ProductsController, HealthController],
  providers: [...infraProviders, { provide: LabFaults, useValue: new LabFaults() }, ProductsService, StockHandler],
})
export class AppModule {}
