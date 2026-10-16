"use client";

import type {
  AdminAnalytics,
  AdminCategoriesResponse,
  AdminCounts,
  AdminOrdersQuery,
  AdminOrdersResponse,
  AdminSellersQuery,
  AdminSellersResponse,
  Category,
  CreateCategoryInput,
  DashboardRange,
  SellerOnboardingStatus,
  UpdateCategoryInput,
} from "@ecommerce/shared";
import { apiRequest } from "@/lib/http";

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const getAdminCounts = () => apiRequest<AdminCounts>("/api/admin/counts");
export const getAdminAnalytics = (range: DashboardRange) =>
  apiRequest<AdminAnalytics>("/api/admin/analytics", { query: { range } });

// Seller
export const listAdminSellers = (query: Partial<AdminSellersQuery>) =>
  apiRequest<AdminSellersResponse>("/api/admin/sellers", { query });
export const approveSeller = (id: string) =>
  apiRequest<SellerOnboardingStatus>(`/api/admin/sellers/${encodeURIComponent(id)}/approve`, { method: "POST" });
export const rejectSeller = (id: string, reason: string) =>
  apiRequest<SellerOnboardingStatus>(`/api/admin/sellers/${encodeURIComponent(id)}/reject`, json("POST", { reason }));

// Kategori
export const listAdminCategories = () => apiRequest<AdminCategoriesResponse>("/api/admin/categories");
export const createCategory = (input: CreateCategoryInput) =>
  apiRequest<Category>("/api/admin/categories", json("POST", input));
export const updateCategory = (id: string, input: UpdateCategoryInput) =>
  apiRequest<Category>(`/api/admin/categories/${encodeURIComponent(id)}`, json("PATCH", input));
export const deleteCategory = (id: string) =>
  apiRequest<null>(`/api/admin/categories/${encodeURIComponent(id)}`, { method: "DELETE" });

// Transaksi
export const listAdminOrders = (query: Partial<AdminOrdersQuery>) =>
  apiRequest<AdminOrdersResponse>("/api/admin/orders", { query });
