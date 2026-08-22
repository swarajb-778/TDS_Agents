CREATE TABLE "signings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"submission_id" integer NOT NULL,
	"submitter_id" integer NOT NULL,
	"embed_src" text NOT NULL,
	"completed_at" timestamp with time zone,
	"change_requested_at" timestamp with time zone,
	"change_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signings" ADD CONSTRAINT "signings_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signings_submission_idx" ON "signings" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "signings_deal_idx" ON "signings" USING btree ("deal_id");