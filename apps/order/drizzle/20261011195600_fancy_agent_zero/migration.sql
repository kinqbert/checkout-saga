CREATE TABLE "orders"."outbox" (
	"id" uuid PRIMARY KEY,
	"seq" bigserial,
	"subject" text NOT NULL,
	"envelope" jsonb NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "orders"."orders" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders"."orders" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders"."orders" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders"."orders" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "outbox_seq_index" ON "orders"."outbox" ("seq") WHERE ("published_at" is null);