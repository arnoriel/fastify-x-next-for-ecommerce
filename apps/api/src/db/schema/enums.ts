import { pgEnum } from "drizzle-orm/pg-core";
import {
  DISPUTE_OUTCOMES,
  DISPUTE_REASONS,
  DISPUTE_STATUSES,
  ESCROW_STATUSES,
  REFUND_MODES,
  RETURN_REASONS,
  RETURN_STATUSES,
  ROLES,
  USER_STATUSES,
} from "@ecommerce/shared";

export const userRole = pgEnum("user_role", ROLES);
export const userStatus = pgEnum("user_status", USER_STATUSES);
export const sellerStatus = pgEnum("seller_status", ["pending", "approved", "rejected", "suspended"]);
export const productStatus = pgEnum("product_status", ["draft", "active", "inactive", "banned"]);
export const checkoutStatus = pgEnum("checkout_status", ["pending", "paid", "expired", "failed", "cancelled"]);
export const orderStatus = pgEnum("order_status", [
  "pending_payment",
  "paid",
  "processing",
  "shipped",
  "delivered",
  "completed",
  "cancelled",
  "return_requested",
  "refund_pending_manual",
  "refunded",
]);
export const voucherType = pgEnum("voucher_type", ["percent", "fixed"]);
export const voucherScope = pgEnum("voucher_scope", ["platform", "seller"]);
export const payoutStatus = pgEnum("payout_status", ["pending", "approved", "rejected", "paid"]);
// T-09B: order_status (perubahan status order), chat_message (pesan baru), seller_status
// (approve/reject onboarding T-03B). T-10: dispute_update (tiket sengketa).
export const notificationType = pgEnum("notification_type", [
  "order_status",
  "chat_message",
  "seller_status",
  "dispute_update",
  "return_update",
]);
// T-10: sengketa order (buyer/seller melapor, admin memutuskan).
export const disputeStatus = pgEnum("dispute_status", DISPUTE_STATUSES);
export const disputeReason = pgEnum("dispute_reason", DISPUTE_REASONS);
export const disputeOutcome = pgEnum("dispute_outcome", DISPUTE_OUTCOMES);
// T-15: retur, refund, dan escrow.
export const returnStatus = pgEnum("return_status", RETURN_STATUSES);
export const returnReason = pgEnum("return_reason", RETURN_REASONS);
export const refundMode = pgEnum("refund_mode", REFUND_MODES);
export const escrowStatus = pgEnum("escrow_status", ESCROW_STATUSES);
