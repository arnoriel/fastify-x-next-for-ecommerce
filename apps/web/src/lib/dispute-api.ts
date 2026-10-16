"use client";

import type {
  AdminListDisputesQuery,
  CreateDisputeInput,
  DisputeDetail,
  DisputeEligibility,
  DisputeListResponse,
  DisputeMessage,
  ListDisputesQuery,
  ResolveDisputeInput,
} from "@ecommerce/shared";
import { apiRequest } from "@/lib/http";

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Sisi tiket: peserta (buyer/seller) memakai /api/disputes, admin memakai /api/admin/disputes. */
export type DisputeMode = "participant" | "admin";
const base = (mode: DisputeMode) => (mode === "admin" ? "/api/admin/disputes" : "/api/disputes");

// Peserta
export const listMyDisputes = (query: Partial<ListDisputesQuery>) =>
  apiRequest<DisputeListResponse>("/api/disputes", { query });
export const getDisputeEligibility = (orderId: string) =>
  apiRequest<DisputeEligibility>("/api/disputes/eligibility", { query: { orderId } });
export const createDispute = (input: CreateDisputeInput) =>
  apiRequest<DisputeDetail>("/api/disputes", json("POST", input));
export const withdrawDispute = (id: string) =>
  apiRequest<DisputeDetail>(`/api/disputes/${encodeURIComponent(id)}/withdraw`, { method: "POST" });

// Admin
export const listAdminDisputes = (query: Partial<AdminListDisputesQuery>) =>
  apiRequest<DisputeListResponse>("/api/admin/disputes", { query });
export const resolveDispute = (id: string, input: ResolveDisputeInput) =>
  apiRequest<DisputeDetail>(`/api/admin/disputes/${encodeURIComponent(id)}/resolve`, json("POST", input));

// Dua sisi
export const getDispute = (mode: DisputeMode, id: string) =>
  apiRequest<DisputeDetail>(`${base(mode)}/${encodeURIComponent(id)}`);
export const postDisputeMessage = (mode: DisputeMode, id: string, body: string) =>
  apiRequest<DisputeMessage>(`${base(mode)}/${encodeURIComponent(id)}/messages`, json("POST", { body }));
