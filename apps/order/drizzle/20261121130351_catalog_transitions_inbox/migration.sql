CREATE TABLE "orders"."inbox" (
	"message_id" uuid,
	"consumer" text,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_pkey" PRIMARY KEY("message_id","consumer")
);
--> statement-breakpoint
CREATE TABLE "orders"."order_transitions" (
	"id" bigserial PRIMARY KEY,
	"order_id" uuid NOT NULL,
	"from_state" "orders"."order_state",
	"to_state" "orders"."order_state" NOT NULL,
	"cause" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders"."products" (
	"sku" text PRIMARY KEY,
	"name" text NOT NULL,
	"price" integer NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER INDEX "orders"."outbox_seq_index" RENAME TO "outbox_unpublished_idx";--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD COLUMN "trace_id" text;--> statement-breakpoint
ALTER TABLE "orders"."outbox" ADD COLUMN "headers" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders"."outbox" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD CONSTRAINT "orders_idempotency_key_key" UNIQUE("idempotency_key");--> statement-breakpoint
CREATE INDEX "order_transitions_order_id_index" ON "orders"."order_transitions" ("order_id");--> statement-breakpoint
ALTER TABLE "orders"."order_transitions" ADD CONSTRAINT "order_transitions_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"."orders"("id");