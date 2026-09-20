"use client";

import type { ErrorResponse, PresignUploadResponse, ProductWithVariants } from "@ecommerce/shared";
import { env } from "@/env";

async function parseOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) {
    const err = body as ErrorResponse;
    throw new Error(err.error?.message ?? `Request gagal (${res.status})`);
  }
  return body as T;
}

function apiUrl(path: string) {
  return new URL(path, env.NEXT_PUBLIC_API_URL).toString();
}

/** Minta presigned URL, lalu upload file langsung ke R2. Return publicUrl untuk disimpan di form. */
export async function uploadProductImage(file: File): Promise<string> {
  const presignRes = await fetch(apiUrl("/api/seller/products/upload-url"), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileName: file.name, contentType: file.type, fileSize: file.size }),
  });
  const presign = await parseOrThrow<PresignUploadResponse>(presignRes);

  const uploadRes = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: { "content-type": file.type },
    body: file,
  });
  if (!uploadRes.ok) throw new Error("Upload gambar ke storage gagal.");

  return presign.publicUrl;
}

export async function createProduct(payload: unknown): Promise<ProductWithVariants> {
  const res = await fetch(apiUrl("/api/seller/products"), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseOrThrow<ProductWithVariants>(res);
}

export async function updateProduct(id: string, payload: unknown): Promise<ProductWithVariants> {
  const res = await fetch(apiUrl(`/api/seller/products/${id}`), {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseOrThrow<ProductWithVariants>(res);
}

export async function deleteProduct(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/seller/products/${id}`), {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok && res.status !== 204) {
    const body = (await res.json()) as ErrorResponse;
    throw new Error(body.error?.message ?? `Request gagal (${res.status})`);
  }
}