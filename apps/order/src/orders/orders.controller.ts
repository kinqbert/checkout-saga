import { PlaceOrderRequest, type OrderView } from "@checkout/contracts";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Response } from "express";
import { OrdersService, UnknownProductsError } from "./orders.service.js";

@Controller("orders")
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  async place(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderView> {
    const parsed = PlaceOrderRequest.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ error: "invalid order", details: parsed.error.issues });
    }
    if (idempotencyKey !== undefined && (idempotencyKey.length < 8 || idempotencyKey.length > 128)) {
      throw new BadRequestException({ error: "Idempotency-Key must be 8-128 characters" });
    }
    try {
      const { order, created } = await this.orders.placeOrder(parsed.data.items, idempotencyKey);
      res.status(created ? 201 : 200);
      return order;
    } catch (err) {
      if (err instanceof UnknownProductsError) {
        throw new UnprocessableEntityException({ error: err.message, details: err.skus });
      }
      throw err;
    }
  }

  @Get()
  list(@Query("limit") limit?: string): Promise<OrderView[]> {
    const n = Math.min(Math.max(Number(limit) || 20, 1), 100);
    return this.orders.list(n);
  }

  @Get(":id")
  async get(@Param("id", new ParseUUIDPipe()) id: string): Promise<OrderView> {
    const order = await this.orders.get(id);
    if (!order) throw new NotFoundException({ error: "order not found" });
    return order;
  }
}
