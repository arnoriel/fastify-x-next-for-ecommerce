"use client";

import type {
  ErrorResponse,
  PresignUploadResponse,
  SellerOnboardingInput,
  SellerOnboardingStatus,
} from "@ecommerce/shared";
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

export async function uploadOnboardingDocument(file: File): Promise<string> {
  const presignRes = await fetch(apiUrl("/api/sellers/onboarding/upload-url"), {
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
  if (!uploadRes.ok) throw new Error("Upload dokumen gagal.");

  return presign.publicUrl;
}

export async function submitSellerOnboarding(payload: SellerOnboardingInput): Promise<SellerOnboardingStatus> {
  const res = await fetch(apiUrl("/api/sellers/onboarding"), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseOrThrow(res);
}

export async function getSellerOnboardingStatus(): Promise<SellerOnboardingStatus | null> {
  const res = await fetch(apiUrl("/api/sellers/onboarding/status"), { credentials: "include" });
  if (res.status === 404) return null;
  return parseOrThrow(res);
}
