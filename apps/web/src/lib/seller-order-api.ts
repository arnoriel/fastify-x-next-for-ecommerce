"use client";

import type {
  DashboardRange,
  SellerDashboardSummary,
  SellerOrderListResponse,
  SellerOrdersQuery,
  SellerShipmentResult,
} from "@ecommerce/shared";
import { apiRequest } from "@/lib/http";

export const getSellerDashboard = (range: DashboardRange) =>
  apiRequest<SellerDashboardSummary>("/api/seller/dashboard/summary", { query: { range } });

export const listSellerOrders = (query: Partial<SellerOrdersQuery>) =>
  apiRequest<SellerOrderListResponse>("/api/seller/orders", { query });

/** Daftarkan pengiriman ke kurir (resi dibuat) — order `paid` → `processing`. */
export const createShipment = (orderId: string) =>
  apiRequest<SellerShipmentResult>(`/api/seller/orders/${orderId}/shipment`, { method: "POST" });

/** Tandai paket sudah diserahkan ke kurir — order `processing` → `shipped`. */
export const markOrderShipped = (orderId: string) =>
  apiRequest<SellerShipmentResult>(`/api/seller/orders/${orderId}/ship`, { method: "POST" });
