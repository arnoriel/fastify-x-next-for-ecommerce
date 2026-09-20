import { relations } from "drizzle-orm";
import { addresses } from "./addresses";
import { accounts, sessions } from "./auth";
import { carts, cartItems } from "./carts";
import { categories, productVariants, products } from "./catalog";
import { conversations, messages, payouts, reviews, wishlists } from "./engagement";
import { checkouts, orderItems, orders, voucherUsages } from "./orders";
import { sellers } from "./sellers";
import { users } from "./users";
import { vouchers } from "./vouchers";

export const usersRelations = relations(users, ({ one, many }) => ({
  seller: one(sellers, { fields: [users.id], references: [sellers.userId] }),
  sessions: many(sessions),
  accounts: many(accounts),
  addresses: many(addresses),
  cart: one(carts, { fields: [users.id], references: [carts.userId] }),
  orders: many(orders),
  reviews: many(reviews),
  wishlists: many(wishlists),
}));

export const addressesRelations = relations(addresses, ({ one }) => ({
  user: one(users, { fields: [addresses.userId], references: [users.id] }),
}));

export const sellersRelations = relations(sellers, ({ one, many }) => ({
  user: one(users, { fields: [sellers.userId], references: [users.id] }),
  products: many(products),
  orders: many(orders),
  vouchers: many(vouchers),
  payouts: many(payouts),
  conversations: many(conversations),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, { fields: [categories.parentId], references: [categories.id], relationName: "tree" }),
  children: many(categories, { relationName: "tree" }),
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  seller: one(sellers, { fields: [products.sellerId], references: [sellers.id] }),
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  variants: many(productVariants),
  reviews: many(reviews),
}));

export const productVariantsRelations = relations(productVariants, ({ one }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
}));

export const cartsRelations = relations(carts, ({ one, many }) => ({
  user: one(users, { fields: [carts.userId], references: [users.id] }),
  items: many(cartItems),
}));

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, { fields: [cartItems.cartId], references: [carts.id] }),
  variant: one(productVariants, { fields: [cartItems.variantId], references: [productVariants.id] }),
}));

export const checkoutsRelations = relations(checkouts, ({ one, many }) => ({
  user: one(users, { fields: [checkouts.userId], references: [users.id] }),
  orders: many(orders),
  voucherUsages: many(voucherUsages),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  checkout: one(checkouts, { fields: [orders.checkoutId], references: [checkouts.id] }),
  user: one(users, { fields: [orders.userId], references: [users.id] }),
  seller: one(sellers, { fields: [orders.sellerId], references: [sellers.id] }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
  variant: one(productVariants, { fields: [orderItems.variantId], references: [productVariants.id] }),
}));

export const vouchersRelations = relations(vouchers, ({ one, many }) => ({
  seller: one(sellers, { fields: [vouchers.sellerId], references: [sellers.id] }),
  usages: many(voucherUsages),
}));

export const voucherUsagesRelations = relations(voucherUsages, ({ one }) => ({
  voucher: one(vouchers, { fields: [voucherUsages.voucherId], references: [vouchers.id] }),
  user: one(users, { fields: [voucherUsages.userId], references: [users.id] }),
  checkout: one(checkouts, { fields: [voucherUsages.checkoutId], references: [checkouts.id] }),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  product: one(products, { fields: [reviews.productId], references: [products.id] }),
  user: one(users, { fields: [reviews.userId], references: [users.id] }),
  orderItem: one(orderItems, { fields: [reviews.orderItemId], references: [orderItems.id] }),
}));

export const wishlistsRelations = relations(wishlists, ({ one }) => ({
  user: one(users, { fields: [wishlists.userId], references: [users.id] }),
  product: one(products, { fields: [wishlists.productId], references: [products.id] }),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  buyer: one(users, { fields: [conversations.buyerId], references: [users.id] }),
  seller: one(sellers, { fields: [conversations.sellerId], references: [sellers.id] }),
  product: one(products, { fields: [conversations.productId], references: [products.id] }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, { fields: [messages.conversationId], references: [conversations.id] }),
  sender: one(users, { fields: [messages.senderId], references: [users.id] }),
}));

export const payoutsRelations = relations(payouts, ({ one }) => ({
  seller: one(sellers, { fields: [payouts.sellerId], references: [sellers.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));
