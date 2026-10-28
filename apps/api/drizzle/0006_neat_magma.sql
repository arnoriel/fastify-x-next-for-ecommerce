ALTER TYPE "public"."order_status" ADD VALUE IF NOT EXISTS 'refund_pending_manual' BEFORE 'refunded';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'return_update';--> statement-breakpoint
CREATE TYPE "public"."escrow_status" AS ENUM('pending', 'held', 'released', 'refund_pending_manual', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."refund_mode" AS ENUM('midtrans', 'manual');--> statement-breakpoint
CREATE TYPE "public"."return_reason" AS ENUM('not_as_described', 'damaged', 'incomplete', 'wrong_item', 'no_longer_needed', 'other');--> statement-breakpoint
CREATE TYPE "public"."return_status" AS ENUM('requested', 'approved', 'rejected', 'refunded', 'cancelled');--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "escrow_status" "escrow_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "escrow_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "escrow_held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "escrow_release_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "escrow_released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "escrow_refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "return_window_ends_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "order_returns" (
	"id" text PRIMARY KEY NOT NULL,
	"return_no" text NOT NULL,
	"order_id" text NOT NULL,
	"buyer_id" text NOT NULL,
	"seller_id" text NOT NULL,
	"status" "return_status" DEFAULT 'requested' NOT NULL,
	"reason" "return_reason" NOT NULL,
	"description" text NOT NULL,
	"evidence_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"amount" integer NOT NULL,
	"refund_bank_name" text NOT NULL,
	"refund_account_number" text NOT NULL,
	"refund_account_holder" text NOT NULL,
	"previous_status" "order_status" NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"resolution_note" text,
	"refund_mode" "refund_mode",
	"refund_reference" text,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_returns_amount_chk" CHECK ("order_returns"."amount" >= 0),
	CONSTRAINT "order_returns_evidence_chk" CHECK (array_length("order_returns"."evidence_urls", 1) is null or array_length("order_returns"."evidence_urls", 1) <= 3)
);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_escrow_amount_chk" CHECK ("orders"."escrow_amount" >= 0);--> statement-breakpoint
ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_returns_no_uq" ON "order_returns" USING btree ("return_no");--> statement-breakpoint
CREATE UNIQUE INDEX "order_returns_order_uq" ON "order_returns" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_returns_status_idx" ON "order_returns" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "order_returns_seller_idx" ON "order_returns" USING btree ("seller_id","status");--> statement-breakpoint
CREATE INDEX "orders_escrow_release_idx" ON "orders" USING btree ("escrow_status","escrow_release_due_at");--> statement-breakpoint
UPDATE "orders" SET
	"escrow_status" = 'held',
	"escrow_amount" = "total",
	"escrow_held_at" = COALESCE("updated_at", now())
WHERE "status" IN ('paid', 'processing', 'shipped', 'delivered', 'completed', 'return_requested');--> statement-breakpoint
UPDATE "orders" SET
	"escrow_status" = 'refunded',
	"escrow_refunded_at" = COALESCE("updated_at", now())
WHERE "status" = 'refunded';--> statement-breakpoint
UPDATE "orders" SET
	"return_window_ends_at" = "completed_at" + interval '3 days',
	"escrow_release_due_at" = "completed_at" + interval '3 days'
WHERE "status" = 'completed' AND "completed_at" IS NOT NULL;
