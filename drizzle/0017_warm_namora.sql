ALTER TABLE "approval_route_steps" ADD COLUMN "approver_sub" text;--> statement-breakpoint
ALTER TABLE "stock_issue_approval_steps" ADD COLUMN "approver_sub" text NOT NULL;--> statement-breakpoint
CREATE INDEX "stock_issue_approval_steps_approver_sub_idx" ON "stock_issue_approval_steps" USING btree ("approver_sub","status");