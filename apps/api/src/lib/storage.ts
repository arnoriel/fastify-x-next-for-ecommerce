import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PresignUploadRequest, PresignUploadResponse } from "@ecommerce/shared";
import { env } from "../env";

const PRESIGN_EXPIRES_SECONDS = 300; // 5 menit — cukup untuk 1 upload, kecil untuk batasi abuse.

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
  // R2 tidak mendukung header checksum tambahan (x-amz-sdk-checksum-algorithm /
  // x-amz-checksum-crc32) yang otomatis disisipkan AWS SDK v3 versi baru — browser lalu
  // gagal preflight CORS karena header itu tidak ada di Allowed Headers bucket, berujung 403
  // di OPTIONS sebelum PUT sempat terkirim. Matikan agar presigned URL tetap "polos" ala S3.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

/**
 * Buat presigned PUT URL untuk upload gambar produk langsung dari browser ke R2.
 * Key di-generate server-side (UUID) — nama file asli TIDAK dipakai sebagai key,
 * supaya tidak bisa dipakai untuk path traversal / overwrite object lain.
 */
export async function presignProductImageUpload(
  sellerId: string,
  input: PresignUploadRequest,
): Promise<PresignUploadResponse> {
  const ext = EXT_BY_MIME[input.contentType];
  const key = `sellers/${sellerId}/products/${randomUUID()}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: key,
    ContentType: input.contentType,
    // ContentLength SENGAJA tidak di-sign: browser fetch/XHR mengatur header Content-Length
    // sendiri saat mengirim body, dan nilainya bisa meleset dari `file.size` yang kita terima
    // di request presign (mis. karena normalisasi encoding) — kalau di-sign, PUT ke R2 akan
    // gagal 403 SignatureDoesNotMatch walau file valid. Validasi ukuran cukup di request presign.
  });

  const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: PRESIGN_EXPIRES_SECONDS });

  return {
    uploadUrl,
    publicUrl: `${env.R2_PUBLIC_URL}/${key}`,
    key,
    expiresIn: PRESIGN_EXPIRES_SECONDS,
  };
}

/** True jika URL gambar berada di bucket publik kita sendiri (dipakai validasi `images[]`). */
export function isOwnedR2Url(url: string): boolean {
  return url.startsWith(`${env.R2_PUBLIC_URL}/`);
}