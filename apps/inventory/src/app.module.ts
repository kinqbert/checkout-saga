import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { infraProviders } from "./infra.js";
import { ProductsController } from "./products/products.controller.js";
import { ProductsService } from "./products/products.service.js";
import { StockHandler } from "./stock/stock.handler.js";

@Module({
  controllers: [ProductsController, HealthController],
  providers: [...infraProviders, ProductsService, StockHandler],
})
export class AppModule {}
