ALTER TYPE "public"."stock_request_status" ADD VALUE 'PARTIAL';--> statement-breakpoint
CREATE TABLE "stock_request_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"issue_no" integer NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_by" uuid NOT NULL,
	"issued_by_name" text NOT NULL,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_request_issues" ADD CONSTRAINT "stock_request_issues_request_id_stock_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."stock_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_request_issues" ADD CONSTRAINT "stock_request_issues_entry_id_stock_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."stock_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_request_issues_no_uq" ON "stock_request_issues" USING btree ("request_id","issue_no");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_request_issues_entry_uq" ON "stock_request_issues" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "stock_request_issues_request_idx" ON "stock_request_issues" USING btree ("request_id","issued_at");