CREATE TABLE "portal_approval_delegations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"delegator_sub" text NOT NULL,
	"delegate_sub" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"revoked_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_approval_delegations_period_valid" CHECK ("portal_approval_delegations"."ends_at" > "portal_approval_delegations"."starts_at"),
	CONSTRAINT "portal_approval_delegations_not_self" CHECK ("portal_approval_delegations"."delegate_sub" <> "portal_approval_delegations"."delegator_sub")
);
--> statement-breakpoint
CREATE INDEX "portal_approval_delegations_delegate_idx" ON "portal_approval_delegations" USING btree ("delegate_sub","revoked_at","ends_at");