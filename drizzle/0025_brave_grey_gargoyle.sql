ALTER TABLE "stock_requests" ADD COLUMN "customer_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "end_user" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "product_model" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "product_serial" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "product_lot" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD COLUMN "received_at" text DEFAULT '' NOT NULL;