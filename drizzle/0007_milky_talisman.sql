CREATE TYPE "public"."workbook_status" AS ENUM('OK', 'PARKED', 'ERROR');--> statement-breakpoint
CREATE TABLE "workbook_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "workbook_status" DEFAULT 'OK' NOT NULL,
	"dirty_at" timestamp with time zone,
	"written_at" timestamp with time zone,
	"written_size" bigint,
	"written_sha256" text,
	"parked_file" text,
	"parked_at" timestamp with time zone,
	"error_message" text,
	"error_count" integer DEFAULT 0 NOT NULL,
	"resumed_by" uuid,
	"resumed_by_name" text,
	"resumed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
