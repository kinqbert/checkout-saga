ALTER TABLE "orders"."orders" ADD COLUMN "deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD COLUMN "trace_headers" jsonb;--> statement-breakpoint
CREATE INDEX "orders_deadline_at_index" ON "orders"."orders" ("deadline_at") WHERE "deadline_at" is not null;--> statement-breakpoint
-- Sagas already waiting when this ships get the usual 20 s from now, so none waits forever.
UPDATE "orders"."orders" SET "deadline_at" = now() + interval '20 seconds' WHERE "state" IN ('AWAITING_STOCK', 'AWAITING_PAYMENT');
