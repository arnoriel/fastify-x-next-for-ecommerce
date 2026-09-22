import { pgEnum } from "drizzle-orm/pg-core";
import { ROLES, USER_STATUSES } from "@ecommerce/shared";

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
  "refunded",
]);
export const voucherType = pgEnum("voucher_type", ["percent", "fixed"]);
export const voucherScope = pgEnum("voucher_scope", ["platform", "seller"]);
export const payoutStatus = pgEnum("payout_status", ["pending", "approved", "rejected", "paid"]);
// T-09B: order_status (perubahan status order), chat_message (pesan baru), seller_status
// (approve/reject onboarding T-03B).
export const notificationType = pgEnum("notification_type", ["order_status", "chat_message", "seller_status"]);
