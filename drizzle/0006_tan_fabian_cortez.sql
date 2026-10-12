CREATE TABLE "part_favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "part_favorites" ADD CONSTRAINT "part_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_favorites" ADD CONSTRAINT "part_favorites_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "part_favorites_user_part_uq" ON "part_favorites" USING btree ("user_id","part_id");--> statement-breakpoint
CREATE INDEX "part_favorites_user_idx" ON "part_favorites" USING btree ("user_id");