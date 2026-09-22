import type { FastifyPluginAsync } from "fastify";
import { asc, eq } from "drizzle-orm";
import { type Address, addressSchema, createAddressSchema, updateAddressSchema } from "@ecommerce/shared";
import { db, schema } from "../../db";
import { httpError } from "../../lib/http-error";
import { requireAuth } from "../../plugins/auth";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function serialize(row: typeof schema.addresses.$inferSelect): Address {
  return addressSchema.parse({
    id: row.id,
    label: row.label,
    recipientName: row.recipientName,
    phone: row.phone,
    province: row.province,
    city: row.city,
    district: row.district,
    postalCode: row.postalCode,
    street: row.street,
    biteshipAreaId: row.biteshipAreaId,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

async function loadOwnedAddress(userId: string, id: string) {
  const address = await db.query.addresses.findFirst({
    where: (a, { and: andd, eq: eqq }) => andd(eqq(a.id, id), eqq(a.userId, userId)),
  });
  if (!address) throw httpError(404, "ADDRESS_NOT_FOUND", "Alamat tidak ditemukan.");
  return address;
}

/** Set 1 alamat jadi default: unset yang lama dulu (constraint unique-partial-index tidak izinkan 2 default). */
async function setAsDefault(tx: Tx, userId: string, addressId: string) {
  await tx.update(schema.addresses).set({ isDefault: false }).where(eq(schema.addresses.userId, userId));
  await tx.update(schema.addresses).set({ isDefault: true }).where(eq(schema.addresses.id, addressId));
}

export const addressRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/addresses", { preHandler: requireAuth }, async (req) => {
    const rows = await db.query.addresses.findMany({
      where: (a, { eq: eqq }) => eqq(a.userId, req.user!.id),
      orderBy: (a) => [asc(a.createdAt)],
    });
    return { items: rows.map(serialize) };
  });

  app.post("/api/addresses", { preHandler: requireAuth }, async (req, reply) => {
    const input = createAddressSchema.parse(req.body);
    const userId = req.user!.id;

    // Alamat pertama otomatis jadi default meski tidak diminta — buyer selalu punya 1 default.
    const existingCount = await db.query.addresses.findFirst({ where: (a, { eq: eqq }) => eqq(a.userId, userId) });
    const makeDefault = input.isDefault || !existingCount;

    const row = await db.transaction(async (tx) => {
      if (makeDefault) await tx.update(schema.addresses).set({ isDefault: false }).where(eq(schema.addresses.userId, userId));
      const [created] = await tx
        .insert(schema.addresses)
        .values({
          userId,
          label: input.label,
          recipientName: input.recipientName,
          phone: input.phone,
          province: input.province,
          city: input.city,
          district: input.district,
          postalCode: input.postalCode,
          street: input.street,
          biteshipAreaId: input.biteshipAreaId ?? null,
          isDefault: makeDefault,
        })
        .returning();
      return created!;
    });

    reply.code(201);
    return serialize(row);
  });

  app.patch("/api/addresses/:id", { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const input = updateAddressSchema.parse(req.body);
    const userId = req.user!.id;
    const existing = await loadOwnedAddress(userId, id);

    const row = await db.transaction(async (tx) => {
      if (input.isDefault === true) await setAsDefault(tx, userId, id);
      const [updated] = await tx
        .update(schema.addresses)
        .set({
          label: input.label ?? existing.label,
          recipientName: input.recipientName ?? existing.recipientName,
          phone: input.phone ?? existing.phone,
          province: input.province ?? existing.province,
          city: input.city ?? existing.city,
          district: input.district ?? existing.district,
          postalCode: input.postalCode ?? existing.postalCode,
          street: input.street ?? existing.street,
          biteshipAreaId: input.biteshipAreaId === undefined ? existing.biteshipAreaId : input.biteshipAreaId,
          isDefault: input.isDefault === true ? true : existing.isDefault,
        })
        .where(eq(schema.addresses.id, id))
        .returning();
      return updated!;
    });

    return serialize(row);
  });

  app.delete("/api/addresses/:id", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.user!.id;
    const { id } = req.params as { id: string };
    const existing = await loadOwnedAddress(userId, id);

    await db.delete(schema.addresses).where(eq(schema.addresses.id, id));

    // Alamat default dihapus & masih ada sisa alamat lain → promosikan yang terlama jadi default,
    // supaya user tidak pernah "kehilangan" default tanpa sadar (checkout butuh 1 alamat terpilih).
    if (existing.isDefault) {
      const next = await db.query.addresses.findFirst({
        where: (a, { eq: eqq }) => eqq(a.userId, userId),
        orderBy: (a, { asc: ascc }) => ascc(a.createdAt),
      });
      if (next) await db.update(schema.addresses).set({ isDefault: true }).where(eq(schema.addresses.id, next.id));
    }

    reply.code(204);
  });
};
