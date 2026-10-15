CREATE TYPE "public"."stock_request_source" AS ENUM('INVENTORY', 'AS');--> statement-breakpoint
ALTER TABLE "stock_requests" ALTER COLUMN "requested_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "source" "stock_request_source" DEFAULT 'INVENTORY' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "external_key" text;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "requester_sub" text;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_requests_external_key_uq" ON "stock_requests" USING btree ("external_key");