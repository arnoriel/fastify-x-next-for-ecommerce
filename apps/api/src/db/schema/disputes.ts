import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { newId, timestamps } from "./_helpers";
import { disputeOutcome, disputeReason, disputeStatus } from "./enums";
import { orders } from "./orders";
import { users } from "./users";

type PartyRole = "buyer" | "seller" | "admin";

// Tiket sengketa (T-10). Pelapor = buyer atau seller dari order; admin memutuskan.
// Aturan inti dijaga DB, bukan hanya service: satu tiket AKTIF per order (partial unique) dan
// `closed_at` terisi persis ketika status sudah tidak aktif.
export const disputes = pgTable(
  "disputes",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    ticketNo: text("ticket_no").notNull(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reporterRole: text("reporter_role").$type<"buyer" | "seller">().notNull(),
    reason: disputeReason("reason").notNull(),
    description: text("description").notNull(),
    status: disputeStatus("status").notNull().default("open"),
    outcome: disputeOutcome("outcome"),
    resolutionNote: text("resolution_note"),
    resolvedBy: text("resolved_by").references(() => users.id, { onDelete: "set null" }),
    // Terisi untuk status resolved/dismissed/withdrawn.
    closedAt: timestamp("closed_at", { withTimezone: true }),
    // Pengirim pesan terakhir — antrian admin "perlu dibalas" tanpa menghitung ulang thread.
    lastMessageRole: text("last_message_role").$type<PartyRole>(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("disputes_ticket_no_uq").on(t.ticketNo),
    uniqueIndex("disputes_order_active_uq")
      .on(t.orderId)
      .where(sql`${t.status} in ('open', 'in_review')`),
    index("disputes_order_idx").on(t.orderId),
    index("disputes_reporter_idx").on(t.reporterId, t.createdAt),
    index("disputes_status_idx").on(t.status, t.updatedAt),
    check("disputes_reporter_role_chk", sql`${t.reporterRole} in ('buyer', 'seller')`),
    check("disputes_description_chk", sql`length(trim(${t.description})) > 0`),
    check("disputes_closed_chk", sql`(${t.status} in ('open', 'in_review')) = (${t.closedAt} is null)`),
  ],
);

export const disputeMessages = pgTable(
  "dispute_messages",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    disputeId: text("dispute_id")
      .notNull()
      .references(() => disputes.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    authorRole: text("author_role").$type<PartyRole>().notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("dispute_messages_dispute_idx").on(t.disputeId, t.createdAt),
    check("dispute_messages_role_chk", sql`${t.authorRole} in ('buyer', 'seller', 'admin')`),
    check("dispute_messages_body_chk", sql`length(trim(${t.body})) > 0`),
  ],
);
