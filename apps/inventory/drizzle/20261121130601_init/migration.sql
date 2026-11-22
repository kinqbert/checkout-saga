CREATE SCHEMA "inventory";
--> statement-breakpoint
CREATE TYPE "inventory"."reservation_status" AS ENUM('RESERVED', 'RELEASED');--> statement-breakpoint
CREATE TABLE "inventory"."inbox" (
	"message_id" uuid,
	"consumer" text,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_pkey" PRIMARY KEY("message_id","consumer")
);
--> statement-breakpoint
CREATE TABLE "inventory"."outbox" (
	"id" uuid PRIMARY KEY,
	"seq" bigserial,
	"subject" text NOT NULL,
	"envelope" jsonb NOT NULL,
	"headers" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inventory"."products" (
	"sku" text PRIMARY KEY,
	"name" text NOT NULL,
	"price" integer NOT NULL,
	"stock" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_not_negative" CHECK ("stock" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory"."reservations" (
	"order_id" uuid PRIMARY KEY,
	"items" jsonb NOT NULL,
	"status" "inventory"."reservation_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "inventory"."outbox" ("seq") WHERE ("published_at" is null);