CREATE TYPE "public"."role" AS ENUM('VIEWER', 'STAFF', 'ADMIN');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_sub" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"role" "role" NOT NULL,
	"sessions_valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sid" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_name" text,
	"action" text NOT NULL,
	"target" text,
	"detail" jsonb
);
--> statement-breakpoint
CREATE UNIQUE INDEX "users_auth_sub_uq" ON "users" USING btree ("auth_sub");--> statement-breakpoint
CREATE INDEX "users_not_deleted_idx" ON "users" USING btree ("id") WHERE "users"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "audit_logs_occurred_at_idx" ON "audit_logs" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id");