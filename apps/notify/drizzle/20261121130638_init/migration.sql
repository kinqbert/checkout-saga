CREATE SCHEMA "notify";
--> statement-breakpoint
CREATE TABLE "notify"."inbox" (
	"message_id" uuid,
	"consumer" text,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_pkey" PRIMARY KEY("message_id","consumer")
);
--> statement-breakpoint
CREATE TABLE "notify"."notifications" (
	"id" uuid PRIMARY KEY,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
