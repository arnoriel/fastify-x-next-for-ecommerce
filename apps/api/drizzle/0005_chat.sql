ALTER TABLE "messages" ADD COLUMN "client_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_client_uq" ON "messages" USING btree ("conversation_id","sender_id","client_id") WHERE "messages"."client_id" is not null;--> statement-breakpoint
CREATE INDEX "conversations_buyer_idx" ON "conversations" USING btree ("buyer_id","last_message_at");
