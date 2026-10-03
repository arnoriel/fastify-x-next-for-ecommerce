import { db } from "../../db";
import { httpError } from "../../lib/http-error";

/** Seller aktif milik user login. 403 kalau belum jadi seller / belum approved. */
export async function requireApprovedSeller(userId: string) {
  const seller = await db.query.sellers.findFirst({ where: (s, { eq: eqq }) => eqq(s.userId, userId) });
  if (!seller) throw httpError(403, "NOT_A_SELLER", "Anda belum terdaftar sebagai seller.");
  if (seller.status !== "approved") {
    throw httpError(403, "SELLER_NOT_APPROVED", "Toko Anda belum disetujui admin.");
  }
  return seller;
}
