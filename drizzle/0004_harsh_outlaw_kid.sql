CREATE TYPE "public"."stock_request_status" AS ENUM('PENDING', 'CONFIRMING', 'CONFIRMED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "stock_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "entry_type" NOT NULL,
	"status" "stock_request_status" DEFAULT 'PENDING' NOT NULL,
	"payload" jsonb NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_by_name" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	"decision_note" text DEFAULT '' NOT NULL,
	"entry_id" uuid
);
--> statement-breakpoint
ALTER TABLE "stock_entries" ADD COLUMN "confirmed_by" uuid;--> statement-breakpoint
ALTER TABLE "stock_entries" ADD COLUMN "confirmed_by_name" text;--> statement-breakpoint
ALTER TABLE "stock_entries" ADD COLUMN "request_id" uuid;--> statement-breakpoint
CREATE INDEX "stock_requests_status_idx" ON "stock_requests" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "stock_requests_requester_idx" ON "stock_requests" USING btree ("requested_by");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_entries_request_uq" ON "stock_entries" USING btree ("request_id");