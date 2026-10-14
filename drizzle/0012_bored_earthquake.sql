CREATE TABLE "oh_part_template_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"product_model_id" uuid NOT NULL,
	"product_model_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "part_overhaul_unit_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_id" uuid NOT NULL,
	"unit_price" bigint NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "part_overhaul_unit_prices_not_negative" CHECK ("part_overhaul_unit_prices"."unit_price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "oh_part_template_items" DROP CONSTRAINT "oh_part_template_items_oh_price_not_negative";--> statement-breakpoint
DROP INDEX "oh_part_templates_not_deleted_idx";--> statement-breakpoint
ALTER TABLE "oh_part_templates" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "oh_part_templates" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "oh_part_templates" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "oh_part_template_models" ADD CONSTRAINT "oh_part_template_models_template_id_oh_part_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."oh_part_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_overhaul_unit_prices" ADD CONSTRAINT "part_overhaul_unit_prices_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oh_part_template_models_model_uq" ON "oh_part_template_models" USING btree ("product_model_id");--> statement-breakpoint
CREATE INDEX "oh_part_template_models_template_idx" ON "oh_part_template_models" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "part_overhaul_unit_prices_part_uq" ON "part_overhaul_unit_prices" USING btree ("part_id");--> statement-breakpoint
ALTER TABLE "oh_part_template_items" DROP COLUMN "oh_price";--> statement-breakpoint
ALTER TABLE "oh_part_templates" DROP COLUMN "sort_order";