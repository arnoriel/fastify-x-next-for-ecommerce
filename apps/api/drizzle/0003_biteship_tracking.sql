ALTER TABLE "orders" ADD COLUMN "biteship_tracking_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_status" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tracking_link" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tracking_synced_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "order_tracking_events" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_tracking_events" ADD CONSTRAINT "order_tracking_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_tracking_events_order_idx" ON "order_tracking_events" USING btree ("order_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_tracking_events_uq" ON "order_tracking_events" USING btree ("order_id","status","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_biteship_order_uq" ON "orders" USING btree ("biteship_order_id") WHERE "orders"."biteship_order_id" is not null;
