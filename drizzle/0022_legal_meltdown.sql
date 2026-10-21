ALTER TYPE "public"."stock_issue_approval_status" ADD VALUE 'EXECUTION_REJECTED';--> statement-breakpoint
ALTER TABLE "stock_issue_approvals" ADD COLUMN "execution_rejected_by" uuid;--> statement-breakpoint
ALTER TABLE "stock_issue_approvals" ADD COLUMN "execution_rejected_by_name" text;--> statement-breakpoint
ALTER TABLE "stock_issue_approvals" ADD COLUMN "execution_rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_issue_approvals" ADD COLUMN "execution_rejected_reason" text;--> statement-breakpoint
ALTER TABLE "stock_issue_approvals" ADD CONSTRAINT "stock_issue_approvals_execution_rejection_metadata" CHECK (
        (status::text <> 'EXECUTION_REJECTED' AND execution_rejected_by IS NULL AND execution_rejected_by_name IS NULL AND execution_rejected_at IS NULL AND execution_rejected_reason IS NULL)
        OR
        (status::text = 'EXECUTION_REJECTED' AND execution_rejected_by IS NOT NULL AND execution_rejected_by_name IS NOT NULL AND execution_rejected_at IS NOT NULL AND execution_rejected_reason IS NOT NULL AND execution_rejected_reason <> '')
      );