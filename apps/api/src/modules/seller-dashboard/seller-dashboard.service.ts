/**
 * T-09: query dashboard & manajemen order seller. Semua query WAJIB di-scope `sellerId`
 * (seller hanya melihat datanya sendiri).
 */

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  DASHBOARD_RANGE_DAYS,
  type DashboardRange,
  SALES_COUNTED_STATUSES,
  SELLER_ORDER_TAB_STATUSES,
  type SellerDashboardSummary,
  type SellerOrderCounts,
  type SellerOrderListResponse,
  type SellerOrdersQuery,
  sellerDashboardSummarySchema,
  sellerOrderListResponseSchema,
  shippingStatusLabel,
} from "@ecommerce/shared";
import { db, schema } from "../../db";
import { FAILED_BOOKING_STATUSES } from "../shipping/shipping.service";

const JAKARTA_TZ = "Asia/Jakarta";
const JAKARTA_OFFSET = "+07:00"; // WIB tidak punya DST
const DAY_MS = 86_400_000;
const COUNTED = [...SALES_COUNTED_STATUSES];

// ---------- Tanggal (WIB) ----------

/** "YYYY-MM-DD" untuk waktu `date` di Asia/Jakarta. */
const jakartaDate = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: JAKARTA_TZ }).format(date);

/** Daftar `days` tanggal berurutan berakhir di hari ini (WIB), mis. 7 hari terakhir termasuk hari ini. */
function lastDays(days: number, now = new Date()): string[] {
  return Array.from({ length: days }, (_, i) => jakartaDate(new Date(now.getTime() - (days - 1 - i) * DAY_MS)));
}

// ---------- Hitung per tab ----------

async function countByTab(sellerId: string): Promise<SellerOrderCounts> {
  const rows = await db
    .select({ status: schema.orders.status, count: sql<number>`count(*)::int` })
    .from(schema.orders)
    .where(eq(schema.orders.sellerId, sellerId))
    .groupBy(schema.orders.status);
  const byStatus = new Map<string, number>(rows.map((r) => [r.status, r.count]));
  const sum = (statuses: readonly string[]) => statuses.reduce((acc, s) => acc + (byStatus.get(s) ?? 0), 0);

  return {
    new: sum(SELLER_ORDER_TAB_STATUSES.new),
    processing: sum(SELLER_ORDER_TAB_STATUSES.processing),
    shipped: sum(SELLER_ORDER_TAB_STATUSES.shipped),
    completed: sum(SELLER_ORDER_TAB_STATUSES.completed),
  };
}

// ---------- Dashboard ----------

export async function getDashboardSummary(sellerId: string, range: DashboardRange): Promise<SellerDashboardSummary> {
  const dates = lastDays(DASHBOARD_RANGE_DAYS[range]);
  const from = dates[0]!;
  const to = dates[dates.length - 1]!;
  const since = new Date(`${from}T00:00:00${JAKARTA_OFFSET}`);

  const inRange = and(
    eq(schema.orders.sellerId, sellerId),
    inArray(schema.orders.status, COUNTED),
    gte(schema.orders.createdAt, since),
  );
  const day = sql<string>`to_char(${schema.orders.createdAt} at time zone 'Asia/Jakarta', 'YYYY-MM-DD')`;

  const [dailyRows, topRows, orderCounts] = await Promise.all([
    db
      .select({
        day,
        orders: sql<number>`count(*)::int`,
        // bigint → string di postgres.js (aman dari overflow int32 untuk omzet besar).
        revenue: sql<string>`coalesce(sum(${schema.orders.subtotal}), 0)::bigint`,
      })
      .from(schema.orders)
      .where(inRange)
      .groupBy(day),
    db
      .select({
        productId: schema.orderItems.productId,
        name: sql<string>`max(${schema.orderItems.productName})`,
        imageUrl: sql<string | null>`max(${schema.orderItems.imageUrl})`,
        quantity: sql<number>`sum(${schema.orderItems.quantity})::int`,
        revenue: sql<string>`sum(${schema.orderItems.subtotal})::bigint`,
      })
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
      .where(inRange)
      .groupBy(schema.orderItems.productId)
      .orderBy(desc(sql`sum(${schema.orderItems.subtotal})`))
      .limit(5),
    countByTab(sellerId),
  ]);

  const byDay = new Map(dailyRows.map((r) => [r.day, r]));
  // Zero-fill: hari tanpa order tetap muncul di grafik (bukan melompat).
  const series = dates.map((date) => {
    const row = byDay.get(date);
    return { date, revenue: row ? Number(row.revenue) : 0, orders: row?.orders ?? 0 };
  });

  const revenue = series.reduce((acc, p) => acc + p.revenue, 0);
  const orders = series.reduce((acc, p) => acc + p.orders, 0);

  return sellerDashboardSummarySchema.parse({
    range,
    from,
    to,
    totals: { revenue, orders, averageOrderValue: orders > 0 ? Math.round(revenue / orders) : 0 },
    series,
    topProducts: topRows.map((r) => ({
      productId: r.productId,
      name: r.name,
      imageUrl: r.imageUrl,
      quantity: r.quantity,
      revenue: Number(r.revenue),
    })),
    orderCounts,
  });
}

// ---------- Daftar order ----------

type OrderWithItems = typeof schema.orders.$inferSelect & { items: (typeof schema.orderItems.$inferSelect)[] };

/** Escape wildcard LIKE supaya input user dicari literal. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

function serializeSellerOrder(order: OrderWithItems) {
  const bookingActive = Boolean(order.biteshipOrderId) && !FAILED_BOOKING_STATUSES.has(order.shippingStatus ?? "");
  const a = order.shippingAddress;

  return {
    id: order.id,
    orderNo: order.orderNo,
    status: order.status,
    recipientName: a.recipientName,
    recipientPhone: a.phone,
    shippingAddress: `${a.street}, ${a.district}, ${a.city}, ${a.province} ${a.postalCode}`,
    courierCode: order.courierCode,
    courierService: order.courierService,
    trackingNumber: order.trackingNumber,
    trackingLink: order.trackingLink,
    shippingStatus: order.shippingStatus,
    shippingStatusLabel: order.shippingStatus ? shippingStatusLabel(order.shippingStatus) : null,
    note: order.note,
    subtotal: order.subtotal,
    shippingCost: order.shippingCost,
    total: order.total,
    items: order.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      variantName: i.variantName,
      imageUrl: i.imageUrl,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      subtotal: i.subtotal,
    })),
    canCreateShipment: order.status === "paid" || (order.status === "processing" && !bookingActive),
    canMarkShipped: order.status === "processing" && bookingActive,
    createdAt: order.createdAt.toISOString(),
    shippedAt: order.shippedAt ? order.shippedAt.toISOString() : null,
    completedAt: order.completedAt ? order.completedAt.toISOString() : null,
  };
}

export async function listSellerOrders(sellerId: string, query: SellerOrdersQuery): Promise<SellerOrderListResponse> {
  const statuses = [...SELLER_ORDER_TAB_STATUSES[query.tab]];
  const search = query.q ? `%${escapeLike(query.q)}%` : null;

  const where = and(
    eq(schema.orders.sellerId, sellerId),
    inArray(schema.orders.status, statuses),
    search ? sql`${schema.orders.orderNo} ilike ${search}` : undefined,
  );

  const [totalRows, counts, rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(schema.orders).where(where),
    countByTab(sellerId),
    db.query.orders.findMany({
      where: (o, { and: andd, eq: eqq, inArray: inArr, sql: sqll }) =>
        andd(
          eqq(o.sellerId, sellerId),
          inArr(o.status, statuses),
          search ? sqll`${o.orderNo} ilike ${search}` : undefined,
        ),
      with: { items: true },
      // Antrian kerja (baru/diproses) FIFO — yang paling lama menunggu di atas; sisanya terbaru dulu.
      orderBy: (o, { asc, desc: descc }) => (query.tab === "new" || query.tab === "processing" ? asc(o.createdAt) : descc(o.createdAt)),
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    }),
  ]);

  return sellerOrderListResponseSchema.parse({
    items: rows.map(serializeSellerOrder),
    page: query.page,
    pageSize: query.pageSize,
    total: totalRows[0]?.count ?? 0,
    counts,
  });
}
