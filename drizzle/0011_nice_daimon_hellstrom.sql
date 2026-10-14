CREATE TABLE "oh_part_template_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"display_order" integer NOT NULL,
	"part_id" uuid,
	"part_name_text" text NOT NULL,
	"quantity" integer NOT NULL,
	"oh_price" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oh_part_template_items_quantity_positive" CHECK ("oh_part_template_items"."quantity" > 0),
	CONSTRAINT "oh_part_template_items_oh_price_not_negative" CHECK ("oh_part_template_items"."oh_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "oh_part_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text
);
--> statement-breakpoint
ALTER TABLE "oh_part_template_items" ADD CONSTRAINT "oh_part_template_items_template_id_oh_part_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."oh_part_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oh_part_template_items" ADD CONSTRAINT "oh_part_template_items_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oh_part_template_items_template_order_uq" ON "oh_part_template_items" USING btree ("template_id","display_order");--> statement-breakpoint
CREATE INDEX "oh_part_template_items_template_idx" ON "oh_part_template_items" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "oh_part_template_items_part_idx" ON "oh_part_template_items" USING btree ("part_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oh_part_templates_code_uq" ON "oh_part_templates" USING btree ("code") WHERE "oh_part_templates"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "oh_part_templates_not_deleted_idx" ON "oh_part_templates" USING btree ("sort_order") WHERE "oh_part_templates"."is_deleted" = false;