import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import {
  presignUploadRequestSchema,
  rejectSellerSchema,
  sellerOnboardingSchema,
  sellerOnboardingStatusSchema,
} from "@ecommerce/shared";
import { db, schema } from "../../db";
import { httpError } from "../../lib/http-error";
import { presignSellerDocumentUpload } from "../../lib/storage";
import { uniqueSlug } from "../../lib/slug";
import { requireAuth, requireRole } from "../../plugins/auth";
import { createNotification } from "../notification/notification.service";

async function slugExists(slug: string) {
  const row = await db.query.sellers.findFirst({ where: (s, { eq: eqq }) => eqq(s.slug, slug) });
  return Boolean(row);
}

function serializeStatus(seller: typeof schema.sellers.$inferSelect) {
  return sellerOnboardingStatusSchema.parse({
    status: seller.status,
    storeName: seller.storeName,
    rejectionReason: seller.rejectionReason,
    submittedAt: seller.createdAt.toISOString(),
  });
}

export const sellerOnboardingRoutes: FastifyPluginAsync = async (app) => {
  // ---------- Presign upload dokumen (KTP/NPWP) — dipanggil buyer sebelum submit form ----------

  app.post("/api/sellers/onboarding/upload-url", { preHandler: requireAuth }, async (req) => {
    const input = presignUploadRequestSchema.parse(req.body);
    return presignSellerDocumentUpload(req.user!.id, input);
  });

  // ---------- Buyer submit form onboarding toko ----------

  app.post("/api/sellers/onboarding", { preHandler: requireAuth }, async (req, reply) => {
    const input = sellerOnboardingSchema.parse(req.body);
    const userId = req.user!.id;

    const existing = await db.query.sellers.findFirst({ where: (s, { eq: eqq }) => eqq(s.userId, userId) });
    if (existing && existing.status !== "rejected") {
      throw httpError(
        409,
        "SELLER_ALREADY_EXISTS",
        existing.status === "pending"
          ? "Anda sudah mengajukan onboarding toko dan sedang menunggu persetujuan."
          : "Anda sudah memiliki toko.",
      );
    }

    const slug = await uniqueSlug(input.storeName, slugExists);

    const values = {
      userId,
      storeName: input.storeName,
      slug,
      status: "pending" as const,
      rejectionReason: null,
      pickupContactName: input.pickupContactName,
      pickupPhone: input.pickupPhone,
      pickupProvince: input.pickupProvince,
      pickupCity: input.pickupCity,
      pickupDistrict: input.pickupDistrict,
      pickupPostalCode: input.pickupPostalCode,
      pickupStreet: input.pickupStreet,
    };

    const seller = existing
      ? (
          await db.update(schema.sellers).set(values).where(eq(schema.sellers.id, existing.id)).returning()
        )[0]!
      : (await db.insert(schema.sellers).values(values).returning())[0]!;

    reply.code(existing ? 200 : 201);
    return serializeStatus(seller);
  });

  // ---------- Polling status ringan di halaman "Menunggu persetujuan" ----------

  app.get("/api/sellers/onboarding/status", { preHandler: requireAuth }, async (req) => {
    const seller = await db.query.sellers.findFirst({ where: (s, { eq: eqq }) => eqq(s.userId, req.user!.id) });
    if (!seller) throw httpError(404, "SELLER_NOT_FOUND", "Anda belum mengajukan onboarding toko.");
    return serializeStatus(seller);
  });

  // ---------- Admin: approve ----------

  app.post("/api/admin/sellers/:id/approve", { preHandler: requireRole(["admin"]) }, async (req) => {
    const { id } = req.params as { id: string };

    const seller = await db.transaction(async (tx) => {
      const [existingSeller] = await tx.select().from(schema.sellers).where(eq(schema.sellers.id, id)).for("update");
      if (!existingSeller) throw httpError(404, "SELLER_NOT_FOUND", "Toko tidak ditemukan.");
      if (existingSeller.status !== "pending") {
        throw httpError(400, "SELLER_NOT_PENDING", "Toko ini tidak sedang menunggu persetujuan.");
      }

      const [updatedSeller] = await tx
        .update(schema.sellers)
        .set({ status: "approved", rejectionReason: null })
        .where(eq(schema.sellers.id, id))
        .returning();

      // Role user di-upgrade jadi seller di sini — dibaca ulang tiap request oleh
      // `resolveSession` (plugins/auth.ts), jadi akses dashboard aktif tanpa perlu re-login.
      await tx.update(schema.users).set({ role: "seller" }).where(eq(schema.users.id, existingSeller.userId));

      return updatedSeller!;
    });

    await createNotification({
      userId: seller.userId,
      type: "seller_status",
      title: "Toko disetujui!",
      body: `Selamat, toko "${seller.storeName}" telah disetujui. Dashboard toko sudah bisa diakses.`,
      payload: { sellerId: seller.id },
    });

    return serializeStatus(seller);
  });

  // ---------- Admin: reject (dengan alasan) ----------

  app.post("/api/admin/sellers/:id/reject", { preHandler: requireRole(["admin"]) }, async (req) => {
    const { id } = req.params as { id: string };
    const input = rejectSellerSchema.parse(req.body);

    const seller = await db.transaction(async (tx) => {
      const [existingSeller] = await tx.select().from(schema.sellers).where(eq(schema.sellers.id, id)).for("update");
      if (!existingSeller) throw httpError(404, "SELLER_NOT_FOUND", "Toko tidak ditemukan.");
      if (existingSeller.status !== "pending") {
        throw httpError(400, "SELLER_NOT_PENDING", "Toko ini tidak sedang menunggu persetujuan.");
      }

      const [updatedSeller] = await tx
        .update(schema.sellers)
        .set({ status: "rejected", rejectionReason: input.reason })
        .where(eq(schema.sellers.id, id))
        .returning();
      return updatedSeller!;
    });

    await createNotification({
      userId: seller.userId,
      type: "seller_status",
      title: "Pengajuan toko ditolak",
      body: `Pengajuan toko "${seller.storeName}" ditolak: ${input.reason}. Anda bisa mengajukan ulang.`,
      payload: { sellerId: seller.id },
    });

    return serializeStatus(seller);
  });

  // ---------- Admin: daftar toko pending (dipakai T-10, disediakan di sini karena erat) ----------

  app.get("/api/admin/sellers", { preHandler: requireRole(["admin"]) }, async (req) => {
    const query = req.query as { status?: string };
    const rows = await db.query.sellers.findMany({
      where: query.status
        ? (s, { eq: eqq }) => eqq(s.status, query.status as "pending" | "approved" | "rejected" | "suspended")
        : undefined,
      orderBy: (s, { desc }) => desc(s.createdAt),
      with: { user: { columns: { id: true, name: true, email: true } } },
    });
    return {
      items: rows.map((s) => ({
        id: s.id,
        storeName: s.storeName,
        status: s.status,
        rejectionReason: s.rejectionReason,
        owner: { id: s.user!.id, name: s.user!.name, email: s.user!.email },
        submittedAt: s.createdAt.toISOString(),
      })),
    };
  });
};
