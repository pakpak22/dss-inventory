CREATE TYPE "public"."charge_type" AS ENUM('PAID', 'FREE');--> statement-breakpoint
CREATE TYPE "public"."entry_type" AS ENUM('RECEIVE', 'USE', 'RETURN', 'DISPOSE', 'ADJUST', 'TRANSFER', 'LOAN', 'OPENING', 'CORRECTION');--> statement-breakpoint
CREATE TYPE "public"."purpose" AS ENUM('REPAIR', 'FIELD', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."sheet" AS ENUM('USE', 'RECEIVE', 'CHANGE');--> statement-breakpoint
CREATE TABLE "stock_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "entry_type" NOT NULL,
	"sheet" "sheet" NOT NULL,
	"occurred_on" date NOT NULL,
	"sheet_year" integer NOT NULL,
	"sheet_no" integer NOT NULL,
	"intake_number" text DEFAULT '' NOT NULL,
	"intake_unverified" boolean DEFAULT false NOT NULL,
	"no_repair_case" boolean DEFAULT false NOT NULL,
	"customer_name" text DEFAULT '' NOT NULL,
	"end_user" text DEFAULT '' NOT NULL,
	"product_model" text DEFAULT '' NOT NULL,
	"product_serial" text DEFAULT '' NOT NULL,
	"product_lot" text DEFAULT '' NOT NULL,
	"usage_place" text DEFAULT '' NOT NULL,
	"purpose" "purpose",
	"purpose_text" text DEFAULT '' NOT NULL,
	"counterparty" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_by_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"quantity_before" integer NOT NULL,
	"quantity_after" integer NOT NULL,
	"charge_type" charge_type,
	"note" text DEFAULT '' NOT NULL,
	"returns_transaction_id" uuid,
	"reverses_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_transactions_delta_nonzero" CHECK ("stock_transactions"."delta" <> 0)
);
--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_entry_id_stock_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."stock_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_returns_transaction_id_stock_transactions_id_fk" FOREIGN KEY ("returns_transaction_id") REFERENCES "public"."stock_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_reverses_transaction_id_stock_transactions_id_fk" FOREIGN KEY ("reverses_transaction_id") REFERENCES "public"."stock_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_entries_sheet_no_uq" ON "stock_entries" USING btree ("sheet","sheet_year","sheet_no");--> statement-breakpoint
CREATE INDEX "stock_entries_occurred_idx" ON "stock_entries" USING btree ("occurred_on");--> statement-breakpoint
CREATE INDEX "stock_entries_type_idx" ON "stock_entries" USING btree ("type");--> statement-breakpoint
CREATE INDEX "stock_entries_intake_idx" ON "stock_entries" USING btree ("intake_number");--> statement-breakpoint
CREATE INDEX "stock_entries_unverified_idx" ON "stock_entries" USING btree ("id") WHERE "stock_entries"."intake_unverified" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_transactions_reverses_uq" ON "stock_transactions" USING btree ("reverses_transaction_id");--> statement-breakpoint
CREATE INDEX "stock_transactions_part_idx" ON "stock_transactions" USING btree ("part_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_transactions_entry_idx" ON "stock_transactions" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "stock_transactions_returns_idx" ON "stock_transactions" USING btree ("returns_transaction_id");