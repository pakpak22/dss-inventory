CREATE TYPE "public"."approval_route_scope" AS ENUM('PART_ISSUE');--> statement-breakpoint
CREATE TABLE "approval_route_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"approver_user_id" uuid NOT NULL,
	"approver_name" text NOT NULL,
	"approver_role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_route_steps_step_order_positive" CHECK ("approval_route_steps"."step_order" >= 1)
);
--> statement-breakpoint
CREATE TABLE "approval_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "approval_route_scope" NOT NULL,
	"version" integer NOT NULL,
	"created_by" uuid,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_route_steps" ADD CONSTRAINT "approval_route_steps_route_id_approval_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."approval_routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_route_steps_order_uq" ON "approval_route_steps" USING btree ("route_id","step_order");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_route_steps_approver_uq" ON "approval_route_steps" USING btree ("route_id","approver_user_id");--> statement-breakpoint
CREATE INDEX "approval_route_steps_approver_idx" ON "approval_route_steps" USING btree ("approver_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_routes_scope_version_uq" ON "approval_routes" USING btree ("scope","version");