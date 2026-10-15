ALTER TYPE "public"."stock_request_status" ADD VALUE 'ON_HOLD';--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "hold_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "held_by" uuid;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "held_by_name" text;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "held_at" timestamp with time zone;