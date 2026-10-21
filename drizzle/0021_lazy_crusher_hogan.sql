CREATE TABLE "approval_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delegator_sub" text NOT NULL,
	"delegator_name" text NOT NULL,
	"delegate_sub" text NOT NULL,
	"delegate_name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_by_sub" text NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_sub" text,
	"revoked_by_name" text,
	CONSTRAINT "approval_delegations_period_valid" CHECK ("approval_delegations"."ends_at" > "approval_delegations"."starts_at"),
	CONSTRAINT "approval_delegations_not_self" CHECK ("approval_delegations"."delegate_sub" <> "approval_delegations"."delegator_sub")
);
--> statement-breakpoint
ALTER TABLE "stock_issue_approval_steps" ADD COLUMN "decided_by_sub" text;--> statement-breakpoint
ALTER TABLE "stock_issue_approval_steps" ADD COLUMN "decided_by_name" text;--> statement-breakpoint
CREATE INDEX "approval_delegations_delegate_idx" ON "approval_delegations" USING btree ("delegate_sub","revoked_at","ends_at");