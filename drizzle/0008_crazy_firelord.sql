CREATE TABLE "workbook_apply_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parked_file" text NOT NULL,
	"parked_sha256" text NOT NULL,
	"plan_fingerprint" text NOT NULL,
	"reason" text NOT NULL,
	"applied_by" uuid NOT NULL,
	"applied_by_name" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entry_ids" jsonb NOT NULL,
	"entry_count" integer NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"summary" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workbook_apply_logs_sha_uq" ON "workbook_apply_logs" USING btree ("parked_sha256");