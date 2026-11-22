CREATE SCHEMA "orders";
--> statement-breakpoint
CREATE TYPE "orders"."order_state" AS ENUM('AWAITING_STOCK', 'AWAITING_PAYMENT', 'RELEASING_STOCK', 'CONFIRMED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "orders"."orders" (
	"id" uuid PRIMARY KEY,
	"state" "orders"."order_state" NOT NULL,
	"amount" integer NOT NULL,
	"items" jsonb NOT NULL,
	"cancel_reason" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
