/** T-10: query panel admin — approval seller, kategori, monitoring transaksi, analytics platform. */

import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  type AdminAnalytics,
  type AdminCategoriesResponse,
  type AdminCounts,
  type AdminOrdersQuery,
  type AdminOrdersResponse,
  type AdminSellersQuery,
  type AdminSellersResponse,
  DASHBOARD_RANGE_DAYS,
  type DashboardRange,
  SALES_COUNTED_STATUSES,
  adminAnalyticsSchema,
  adminCategoriesResponseSchema,
  adminCountsSchema,
  adminOrdersResponseSchema,
  adminSellersResponseSchema,
  shippingStatusLabel,
} from "@ecommerce/shared";
import { db, schema } from "../../db";
import { lastDays, rangeStart } from "../../lib/jakarta-range";
import { escapeLike, pageOffset } from "../../lib/sql";
import { serializeCategory } from "../catalog/category.routes";
import { loadDisputeStates } from "../dispute/dispute.service";

const COUNTED = [...SALES_COUNTED_STATUSES];
const ACTIVE_DISPUTES = sql`${schema.disputes.status} in ('open', 'in_review')`;
const NEEDS_REPLY = and(ACTIVE_DISPUTES, sql`${schema.disputes.lastMessageRole} in ('buyer', 'seller')`);

// ---------- Badge navigasi ----------

export async function getAdminCounts(): Promise<AdminCounts> {
  const [[pending], [active], [needsReply], [pendingReturns], [refundQueue]] = await Promise.all([
    db.select({ n: count() }).from(schema.sellers).where(eq(schema.sellers.status, "pending")),
    db.select({ n: count() }).from(schema.disputes).where(ACTIVE_DISPUTES),
    db.select({ n: count() }).from(schema.disputes).where(NEEDS_REPLY),
    db.select({ n: count() }).from(schema.orderReturns).where(eq(schema.orderReturns.status, "requested")),
    db.select({ n: count() }).from(schema.orderReturns).where(eq(schema.orderReturns.status, "approved")),
  ]);
  return adminCountsSchema.parse({
    pendingSellers: pending?.n ?? 0,
    activeDisputes: active?.n ?? 0,
    needsReply: needsReply?.n ?? 0,
    pendingReturns: pendingReturns?.n ?? 0,
    refundQueue: refundQueue?.n ?? 0,
  });
}

// ---------- Approval seller ----------

export async function listAdminSellers(query: AdminSellersQuery): Promise<AdminSellersResponse> {
  const search = query.q ? `%${escapeLike(query.q)}%` : null;
  const where = and(
    eq(schema.sellers.status, query.status),
    search
      ? or(
          sql`${schema.sellers.storeName} ilike ${search}`,
          sql`${schema.users.name} ilike ${search}`,
          sql`${schema.users.email} ilike ${search}`,
        )
      : undefined,
  );

  const [rows, [totalRow], statusRows] = await Promise.all([
    db
      .select({ seller: schema.sellers, owner: { id: schema.users.id, name: schema.users.name, email: schema.users.email } })
      .from(schema.sellers)
      .innerJoin(schema.users, eq(schema.sellers.userId, schema.users.id))
      .where(where)
      // Antrian approval FIFO (yang paling lama menunggu di atas); riwayat keputusan terbaru dulu.
      .orderBy(query.status === "pending" ? asc(schema.sellers.createdAt) : desc(schema.sellers.updatedAt))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db
      .select({ n: count() })
      .from(schema.sellers)
      .innerJoin(schema.users, eq(schema.sellers.userId, schema.users.id))
      .where(where),
    db.select({ status: schema.sellers.status, n: count() }).from(schema.sellers).groupBy(schema.sellers.status),
  ]);

  const byStatus = new Map<string, number>(statusRows.map((r) => [r.status, r.n]));

  return adminSellersResponseSchema.parse({
    items: rows.map(({ seller: s, owner }) => {
      const parts = [s.pickupStreet, s.pickupDistrict, s.pickupCity, s.pickupProvince].filter(Boolean).join(", ");
      return {
        id: s.id,
        storeName: s.storeName,
        status: s.status,
        rejectionReason: s.rejectionReason,
        owner,
        contactName: s.pickupContactName,
        phone: s.pickupPhone,
        pickupAddress: parts ? `${parts}${s.pickupPostalCode ? ` ${s.pickupPostalCode}` : ""}` : null,
        documentUrl: s.documentUrl,
        submittedAt: s.createdAt.toISOString(),
      };
    }),
    page: query.page,
    pageSize: query.pageSize,
    total: totalRow?.n ?? 0,
    counts: {
      pending: byStatus.get("pending") ?? 0,
      approved: byStatus.get("approved") ?? 0,
      rejected: byStatus.get("rejected") ?? 0,
      suspended: byStatus.get("suspended") ?? 0,
    },
  });
}

// ---------- Kategori ----------

/** Semua kategori (termasuk nonaktif) + jumlah produk aktif & sub-kategori — endpoint publik hanya yang aktif. */
export async function listAdminCategories(): Promise<AdminCategoriesResponse> {
  // Hitung lewat query terpisah (bukan subquery berkorelasi) — lebih jelas dan tidak bergantung
  // pada cara Drizzle menulis nama kolom saat query hanya satu tabel.
  const [rows, productRows, childRows] = await Promise.all([
    db.select().from(schema.categories).orderBy(asc(schema.categories.sortOrder), asc(schema.categories.name)),
    db
      .select({ categoryId: schema.products.categoryId, n: count() })
      .from(schema.products)
      .where(isNull(schema.products.deletedAt))
      .groupBy(schema.products.categoryId),
    db
      .select({ parentId: schema.categories.parentId, n: count() })
      .from(schema.categories)
      .where(isNotNull(schema.categories.parentId))
      .groupBy(schema.categories.parentId),
  ]);
  const products = new Map<string, number>(productRows.map((r) => [r.categoryId, r.n]));
  const children = new Map<string, number>(childRows.map((r) => [r.parentId!, r.n]));

  return adminCategoriesResponseSchema.parse({
    items: rows.map((c) => ({
      ...serializeCategory(c),
      productCount: products.get(c.id) ?? 0,
      childCount: children.get(c.id) ?? 0,
    })),
  });
}

// ---------- Monitoring transaksi ----------

export async function listAdminOrders(query: AdminOrdersQuery): Promise<AdminOrdersResponse> {
  const search = query.q ? `%${escapeLike(query.q)}%` : null;
  const where = and(
    query.status ? eq(schema.orders.status, query.status) : undefined,
    search
      ? or(
          sql`${schema.orders.orderNo} ilike ${search}`,
          sql`${schema.users.name} ilike ${search}`,
          sql`${schema.users.email} ilike ${search}`,
          sql`${schema.sellers.storeName} ilike ${search}`,
        )
      : undefined,
  );

  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: schema.orders.id,
        orderNo: schema.orders.orderNo,
        status: schema.orders.status,
        total: schema.orders.total,
        shippingStatus: schema.orders.shippingStatus,
        createdAt: schema.orders.createdAt,
        buyerName: schema.users.name,
        buyerEmail: schema.users.email,
        storeName: schema.sellers.storeName,
      })
      .from(schema.orders)
      .innerJoin(schema.sellers, eq(schema.orders.sellerId, schema.sellers.id))
      .leftJoin(schema.users, eq(schema.orders.userId, schema.users.id))
      .where(where)
      .orderBy(desc(schema.orders.createdAt))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db
      .select({ n: count() })
      .from(schema.orders)
      .innerJoin(schema.sellers, eq(schema.orders.sellerId, schema.sellers.id))
      .leftJoin(schema.users, eq(schema.orders.userId, schema.users.id))
      .where(where),
  ]);

  const ids = rows.map((r) => r.id);
  const [disputes, itemRows] = await Promise.all([
    loadDisputeStates(ids),
    ids.length === 0
      ? Promise.resolve([])
      : db
          .select({ orderId: schema.orderItems.orderId, qty: sql<number>`sum(${schema.orderItems.quantity})::int` })
          .from(schema.orderItems)
          .where(inArray(schema.orderItems.orderId, ids))
          .groupBy(schema.orderItems.orderId),
  ]);
  const itemCounts = new Map<string, number>(itemRows.map((r) => [r.orderId, r.qty]));

  return adminOrdersResponseSchema.parse({
    items: rows.map((r) => ({
      id: r.id,
      orderNo: r.orderNo,
      status: r.status,
      total: r.total,
      buyerName: r.buyerName,
      buyerEmail: r.buyerEmail,
      storeName: r.storeName,
      itemCount: itemCounts.get(r.id) ?? 0,
      shippingStatusLabel: r.shippingStatus ? shippingStatusLabel(r.shippingStatus) : null,
      activeDisputeId: disputes.get(r.id)?.activeId ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    page: query.page,
    pageSize: query.pageSize,
    total: totalRow?.n ?? 0,
  });
}

// ---------- Analytics platform ----------

export async function getAdminAnalytics(range: DashboardRange): Promise<AdminAnalytics> {
  const dates = lastDays(DASHBOARD_RANGE_DAYS[range]);
  const from = dates[0]!;
  const to = dates[dates.length - 1]!;
  const since = rangeStart(from);

  const sold = and(inArray(schema.orders.status, COUNTED), gte(schema.orders.createdAt, since));
  const day = sql<string>`to_char(${schema.orders.createdAt} at time zone 'Asia/Jakarta', 'YYYY-MM-DD')`;

  const [
    dailyRows,
    statusRows,
    topSellerRows,
    topCategoryRows,
    [newUsers],
    [newSellers],
    [users],
    sellerStatusRows,
    [activeProducts],
    [activeDisputes],
    [needsReply],
    [openedInRange],
    [closedInRange],
  ] = await Promise.all([
    db
      .select({
        day,
        orders: sql<number>`count(*)::int`,
        // bigint → string di postgres.js (aman dari overflow int32 untuk GMV besar).
        gmv: sql<string>`coalesce(sum(${schema.orders.total}), 0)::bigint`,
      })
      .from(schema.orders)
      .where(sold)
      .groupBy(day),
    db
      .select({ status: schema.orders.status, n: count() })
      .from(schema.orders)
      .where(gte(schema.orders.createdAt, since))
      .groupBy(schema.orders.status),
    db
      .select({
        sellerId: schema.orders.sellerId,
        storeName: sql<string>`max(${schema.sellers.storeName})`,
        orders: sql<number>`count(*)::int`,
        revenue: sql<string>`sum(${schema.orders.total})::bigint`,
      })
      .from(schema.orders)
      .innerJoin(schema.sellers, eq(schema.orders.sellerId, schema.sellers.id))
      .where(sold)
      .groupBy(schema.orders.sellerId)
      .orderBy(desc(sql`sum(${schema.orders.total})`))
      .limit(5),
    db
      .select({
        categoryId: schema.categories.id,
        name: sql<string>`max(${schema.categories.name})`,
        quantity: sql<number>`sum(${schema.orderItems.quantity})::int`,
        revenue: sql<string>`sum(${schema.orderItems.subtotal})::bigint`,
      })
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
      .innerJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
      .innerJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
      .where(sold)
      .groupBy(schema.categories.id)
      .orderBy(desc(sql`sum(${schema.orderItems.subtotal})`))
      .limit(5),
    db.select({ n: count() }).from(schema.users).where(gte(schema.users.createdAt, since)),
    db.select({ n: count() }).from(schema.sellers).where(gte(schema.sellers.createdAt, since)),
    db.select({ n: count() }).from(schema.users),
    db.select({ status: schema.sellers.status, n: count() }).from(schema.sellers).groupBy(schema.sellers.status),
    db
      .select({ n: count() })
      .from(schema.products)
      .where(sql`${schema.products.status} = 'active' and ${schema.products.deletedAt} is null`),
    db.select({ n: count() }).from(schema.disputes).where(ACTIVE_DISPUTES),
    db.select({ n: count() }).from(schema.disputes).where(NEEDS_REPLY),
    db.select({ n: count() }).from(schema.disputes).where(gte(schema.disputes.createdAt, since)),
    db.select({ n: count() }).from(schema.disputes).where(gte(schema.disputes.closedAt, since)),
  ]);

  const byDay = new Map(dailyRows.map((r) => [r.day, r]));
  // Zero-fill: hari tanpa order tetap muncul di grafik (bukan melompat).
  const series = dates.map((date) => {
    const row = byDay.get(date);
    return { date, revenue: row ? Number(row.gmv) : 0, orders: row?.orders ?? 0 };
  });
  const gmv = series.reduce((acc, p) => acc + p.revenue, 0);
  const orders = series.reduce((acc, p) => acc + p.orders, 0);
  const sellerStatus = new Map<string, number>(sellerStatusRows.map((r) => [r.status, r.n]));

  return adminAnalyticsSchema.parse({
    range,
    from,
    to,
    totals: {
      gmv,
      orders,
      averageOrderValue: orders > 0 ? Math.round(gmv / orders) : 0,
      newUsers: newUsers?.n ?? 0,
      newSellers: newSellers?.n ?? 0,
    },
    platform: {
      users: users?.n ?? 0,
      activeSellers: sellerStatus.get("approved") ?? 0,
      pendingSellers: sellerStatus.get("pending") ?? 0,
      activeProducts: activeProducts?.n ?? 0,
    },
    series,
    statusBreakdown: statusRows.map((r) => ({ status: r.status, count: r.n })).sort((a, b) => b.count - a.count),
    topSellers: topSellerRows.map((r) => ({
      sellerId: r.sellerId,
      storeName: r.storeName,
      orders: r.orders,
      revenue: Number(r.revenue),
    })),
    topCategories: topCategoryRows.map((r) => ({
      categoryId: r.categoryId,
      name: r.name,
      quantity: r.quantity,
      revenue: Number(r.revenue),
    })),
    disputes: {
      active: activeDisputes?.n ?? 0,
      needsReply: needsReply?.n ?? 0,
      openedInRange: openedInRange?.n ?? 0,
      closedInRange: closedInRange?.n ?? 0,
    },
  });
}
