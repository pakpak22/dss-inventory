CREATE TYPE "public"."category" AS ENUM('RFG', 'MB', 'COMPATIBLE');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('JPY', 'KRW');--> statement-breakpoint
CREATE TYPE "public"."owner" AS ENUM('DSS', 'KYOSAN', 'SERVICE_SPARE');--> statement-breakpoint
CREATE SEQUENCE "public"."parts_no_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "part_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text
);
--> statement-breakpoint
CREATE TABLE "parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"no" integer DEFAULT nextval('parts_no_seq') NOT NULL,
	"name" text NOT NULL,
	"name2" text DEFAULT '' NOT NULL,
	"kyosan_part_no" text DEFAULT '' NOT NULL,
	"drawing_no" text DEFAULT '' NOT NULL,
	"supply_price" bigint,
	"supply_currency" "currency" DEFAULT 'JPY' NOT NULL,
	"quote_price" bigint,
	"note" text DEFAULT '' NOT NULL,
	"item_id" uuid NOT NULL,
	"category" "category" NOT NULL,
	"owner" "owner" NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text
);
--> statement-breakpoint
CREATE TABLE "stock_balances" (
	"part_id" uuid PRIMARY KEY NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_balances_quantity_nonnegative" CHECK ("stock_balances"."quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_item_id_part_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."part_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "part_items_code_uq" ON "part_items" USING btree ("code");--> statement-breakpoint
CREATE INDEX "part_items_not_deleted_idx" ON "part_items" USING btree ("sort_order") WHERE "part_items"."is_deleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "parts_no_uq" ON "parts" USING btree ("no");--> statement-breakpoint
CREATE INDEX "parts_not_deleted_idx" ON "parts" USING btree ("no") WHERE "parts"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "parts_item_idx" ON "parts" USING btree ("item_id");