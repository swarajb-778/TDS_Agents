CREATE TABLE "conflict_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"note" text,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conflict_acknowledgements" ADD CONSTRAINT "conflict_acknowledgements_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conflict_ack_deal_rule_idx" ON "conflict_acknowledgements" USING btree ("deal_id","rule_id");