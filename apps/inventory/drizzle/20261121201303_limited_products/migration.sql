ALTER TABLE "inventory"."products" ADD COLUMN "limited" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Sneakers stay genuinely limited so the "Out of stock" scenario always has something to hit.
UPDATE "inventory"."products" SET "limited" = true WHERE "sku" = 'sneakers';
