import type { ProductView } from "@checkout/contracts";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import * as z from "zod";
import { ProductsService } from "./products.service.js";

const PriceChange = z.object({ price: z.int().min(1).max(1_000_000) });

@Controller("products")
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(): Promise<ProductView[]> {
    return this.products.list();
  }

  @Post("restock")
  restock(): Promise<ProductView[]> {
    return this.products.restock();
  }

  @Patch(":sku")
  async setPrice(@Param("sku") sku: string, @Body() body: unknown): Promise<ProductView> {
    const parsed = PriceChange.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ error: "price must be integer cents" });
    const product = await this.products.setPrice(sku, parsed.data.price);
    if (!product) throw new NotFoundException({ error: "product not found" });
    return product;
  }
}
