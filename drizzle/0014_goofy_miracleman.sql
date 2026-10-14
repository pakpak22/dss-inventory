DROP INDEX "oh_part_templates_code_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "oh_part_templates_name_uq" ON "oh_part_templates" USING btree ("name") WHERE "oh_part_templates"."is_deleted" = false;--> statement-breakpoint
ALTER TABLE "oh_part_templates" DROP COLUMN "code";