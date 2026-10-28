"use client";

import type {
  AdminReturnListResponse,
  AdminReturnsQuery,
  CompleteRefundInput,
  CreateReturnInput,
  PresignUploadResponse,
  ReturnDetail,
} from "@ecommerce/shared";
import { apiRequest } from "@/lib/http";

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const createReturn = (orderId: string, input: CreateReturnInput) =>
  apiRequest<ReturnDetail>(`/api/orders/${encodeURIComponent(orderId)}/returns`, json("POST", input));

export const getReturn = (id: string) =>
  apiRequest<ReturnDetail>(`/api/returns/${encodeURIComponent(id)}`);

export const cancelReturn = (id: string) =>
  apiRequest<ReturnDetail>(`/api/returns/${encodeURIComponent(id)}/cancel`, { method: "POST" });

export const getSellerReturn = (id: string) =>
  apiRequest<ReturnDetail>(`/api/seller/returns/${encodeURIComponent(id)}`);

export const reviewSellerReturn = (id: string, decision: "approve" | "reject", note: string) =>
  apiRequest<ReturnDetail>(`/api/seller/returns/${encodeURIComponent(id)}/${decision}`, json("POST", { note }));

export const getAdminReturn = (id: string) =>
  apiRequest<ReturnDetail>(`/api/admin/returns/${encodeURIComponent(id)}`);

export const listAdminReturns = (query: Partial<AdminReturnsQuery>) =>
  apiRequest<AdminReturnListResponse>("/api/admin/returns", { query });

export const reviewAdminReturn = (id: string, decision: "approve" | "reject", note: string) =>
  apiRequest<ReturnDetail>(`/api/admin/returns/${encodeURIComponent(id)}/${decision}`, json("POST", { note }));

export const completeReturnRefund = (id: string, input: CompleteRefundInput) =>
  apiRequest<ReturnDetail>(`/api/admin/returns/${encodeURIComponent(id)}/refund`, json("POST", input));

/** Presign lalu PUT langsung ke R2 — pola sama dengan upload gambar produk (T-04). */
export async function uploadReturnEvidence(orderId: string, file: File): Promise<string> {
  const presign = await apiRequest<PresignUploadResponse>(
    `/api/orders/${encodeURIComponent(orderId)}/return/upload-url`,
    json("POST", { fileName: file.name, contentType: file.type, fileSize: file.size }),
  );
  const upload = await fetch(presign.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
  if (!upload.ok) throw new Error("Upload foto bukti gagal.");
  return presign.publicUrl;
}
