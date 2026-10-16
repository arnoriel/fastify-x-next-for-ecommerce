ALTER TYPE "public"."notification_type" ADD VALUE 'dispute_update';--> statement-breakpoint
CREATE TYPE "public"."dispute_outcome" AS ENUM('favor_buyer', 'favor_seller');--> statement-breakpoint
CREATE TYPE "public"."dispute_reason" AS ENUM('item_not_received', 'item_not_as_described', 'item_damaged', 'item_incomplete', 'seller_unresponsive', 'buyer_unreachable', 'delivery_refused', 'false_claim', 'other');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('open', 'in_review', 'resolved', 'dismissed', 'withdrawn');--> statement-breakpoint
ALTER TABLE "sellers" ADD COLUMN "document_url" text;--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_no" text NOT NULL,
	"order_id" text NOT NULL,
	"reporter_id" text NOT NULL,
	"reporter_role" text NOT NULL,
	"reason" "dispute_reason" NOT NULL,
	"description" text NOT NULL,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"outcome" "dispute_outcome",
	"resolution_note" text,
	"resolved_by" text,
	"closed_at" timestamp with time zone,
	"last_message_role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disputes_reporter_role_chk" CHECK ("disputes"."reporter_role" in ('buyer', 'seller')),
	CONSTRAINT "disputes_description_chk" CHECK (length(trim("disputes"."description")) > 0),
	CONSTRAINT "disputes_closed_chk" CHECK (("disputes"."status" in ('open', 'in_review')) = ("disputes"."closed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "dispute_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"dispute_id" text NOT NULL,
	"author_id" text NOT NULL,
	"author_role" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispute_messages_role_chk" CHECK ("dispute_messages"."author_role" in ('buyer', 'seller', 'admin')),
	CONSTRAINT "dispute_messages_body_chk" CHECK (length(trim("dispute_messages"."body")) > 0)
);
--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "disputes_ticket_no_uq" ON "disputes" USING btree ("ticket_no");--> statement-breakpoint
CREATE UNIQUE INDEX "disputes_order_active_uq" ON "disputes" USING btree ("order_id") WHERE "disputes"."status" in ('open', 'in_review');--> statement-breakpoint
CREATE INDEX "disputes_order_idx" ON "disputes" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "disputes_reporter_idx" ON "disputes" USING btree ("reporter_id","created_at");--> statement-breakpoint
CREATE INDEX "disputes_status_idx" ON "disputes" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "dispute_messages_dispute_idx" ON "dispute_messages" USING btree ("dispute_id","created_at");
