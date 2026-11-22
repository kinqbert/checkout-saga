CREATE SCHEMA "payments";
--> statement-breakpoint
CREATE TYPE "payments"."payment_status" AS ENUM('CAPTURED', 'FAILED');--> statement-breakpoint
CREATE TABLE "payments"."inbox" (
	"message_id" uuid,
	"consumer" text,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_pkey" PRIMARY KEY("message_id","consumer")
);
--> statement-breakpoint
CREATE TABLE "payments"."outbox" (
	"id" uuid PRIMARY KEY,
	"seq" bigserial,
	"subject" text NOT NULL,
	"envelope" jsonb NOT NULL,
	"headers" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payments"."payments" (
	"id" uuid PRIMARY KEY,
	"order_id" uuid NOT NULL UNIQUE,
	"amount" integer NOT NULL,
	"status" "payments"."payment_status" NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "payments"."outbox" ("seq") WHERE ("published_at" is null);