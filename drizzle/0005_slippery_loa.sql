CREATE TYPE "public"."legacy_match_status" AS ENUM('CONFIRMED', 'GROUP_DECIDED', 'OWNER_MISMATCH');--> statement-breakpoint
CREATE TYPE "public"."legacy_sheet" AS ENUM('USE', 'RECEIVE');--> statement-breakpoint
CREATE TABLE "legacy_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sheet" "legacy_sheet" NOT NULL,
	"source_row" integer NOT NULL,
	"sheet_no" integer,
	"occurred_on" date,
	"date_text" text DEFAULT '' NOT NULL,
	"intake_number" text DEFAULT '' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"name2" text DEFAULT '' NOT NULL,
	"drawing_no" text DEFAULT '' NOT NULL,
	"kyosan_part_no" text DEFAULT '' NOT NULL,
	"stock_before" integer,
	"quantity" integer,
	"stock_after" integer,
	"purpose_text" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"owner_text" text DEFAULT '' NOT NULL,
	"charge_text" text DEFAULT '' NOT NULL,
	"usage_place" text DEFAULT '' NOT NULL,
	"anomaly" text DEFAULT '' NOT NULL,
	"part_id" uuid NOT NULL,
	"match_status" "legacy_match_status" NOT NULL,
	"match_note" text DEFAULT '' NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_by_name" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legacy_records" ADD CONSTRAINT "legacy_records_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_records_sheet_row_uq" ON "legacy_records" USING btree ("sheet","source_row");--> statement-breakpoint
CREATE INDEX "legacy_records_part_idx" ON "legacy_records" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX "legacy_records_occurred_idx" ON "legacy_records" USING btree ("occurred_on");--> statement-breakpoint
CREATE UNIQUE INDEX "app_settings_key_uq" ON "app_settings" USING btree ("key");