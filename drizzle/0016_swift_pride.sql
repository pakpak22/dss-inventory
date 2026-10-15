CREATE TYPE "public"."stock_issue_approval_status" AS ENUM('PENDING_APPROVAL', 'APPROVED', 'EXECUTED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."stock_issue_approval_step_status" AS ENUM('REQUESTED', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "stock_issue_approval_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"approval_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"approver_user_id" uuid NOT NULL,
	"approver_name" text NOT NULL,
	"approver_role" text NOT NULL,
	"status" "stock_issue_approval_step_status" DEFAULT 'REQUESTED' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "stock_issue_approval_steps_step_order_positive" CHECK ("stock_issue_approval_steps"."step_order" >= 1),
	CONSTRAINT "stock_issue_approval_steps_decision_metadata" CHECK (
        (status = 'REQUESTED' AND decided_at IS NULL)
        OR
        (status = 'APPROVED' AND decided_at IS NOT NULL)
        OR
        (status = 'REJECTED' AND decided_at IS NOT NULL AND note <> '')
      )
);
--> statement-breakpoint
CREATE TABLE "stock_issue_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"status" "stock_issue_approval_status" DEFAULT 'PENDING_APPROVAL' NOT NULL,
	"quantities" jsonb NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_by_name" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entry_id" uuid,
	"executed_by" uuid,
	"executed_by_name" text,
	"executed_at" timestamp with time zone,
	CONSTRAINT "stock_issue_approvals_execution_metadata" CHECK (
        (status <> 'EXECUTED' AND executed_by IS NULL AND executed_by_name IS NULL AND executed_at IS NULL AND entry_id IS NULL)
        OR
        (status = 'EXECUTED' AND executed_by IS NOT NULL AND executed_by_name IS NOT NULL AND executed_at IS NOT NULL AND entry_id IS NOT NULL)
      )
);
--> statement-breakpoint
ALTER TABLE "stock_issue_approval_steps" ADD CONSTRAINT "stock_issue_approval_steps_approval_id_stock_issue_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."stock_issue_approvals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_issue_approvals" ADD CONSTRAINT "stock_issue_approvals_request_id_stock_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."stock_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_issue_approvals" ADD CONSTRAINT "stock_issue_approvals_route_id_approval_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."approval_routes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_issue_approvals" ADD CONSTRAINT "stock_issue_approvals_entry_id_stock_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."stock_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_issue_approval_steps_order_uq" ON "stock_issue_approval_steps" USING btree ("approval_id","step_order");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_issue_approval_steps_one_open_uq" ON "stock_issue_approval_steps" USING btree ("approval_id") WHERE status = 'REQUESTED';--> statement-breakpoint
CREATE INDEX "stock_issue_approval_steps_approver_idx" ON "stock_issue_approval_steps" USING btree ("approver_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_issue_approvals_request_open_uq" ON "stock_issue_approvals" USING btree ("request_id") WHERE status in ('PENDING_APPROVAL', 'APPROVED');--> statement-breakpoint
CREATE INDEX "stock_issue_approvals_status_idx" ON "stock_issue_approvals" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "stock_issue_approvals_requester_idx" ON "stock_issue_approvals" USING btree ("requested_by","status");