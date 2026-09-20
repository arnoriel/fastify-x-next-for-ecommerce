import { faker } from "@faker-js/faker";
import { hashPassword } from "better-auth/crypto";
import { sql as dsql } from "drizzle-orm";
import { closeDb } from "../../lib/db";
import { env } from "../../env";
import { db, schema } from "../index";
import { SEED_PASSWORD, bankSeed, categorySeed, cities, courierSeed } from "./data";

const {
  users, accounts, addresses, sellers, categories, products, productVariants, carts, cartItems,
  vouchers, checkouts, orders, orderItems, voucherUsages, reviews, wishlists,
  conversations, messages, payouts,
} = schema;

// Deterministik: seed yang sama = data yang sama (mudah di-debug & di-test).
faker.seed(20260101);
faker.setDefaultRefDate(new Date("2026-01-15T00:00:00Z"));

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const rp = (n: number) => Math.round(n / 500) * 500; // bulatkan ke Rp500

async function main() {
  if (env.NODE_ENV === "production") throw new Error("db:seed diblokir di NODE_ENV=production");

  // Tolak jika DB sudah berisi data agar tidak dobel/campur (pakai `npm run db:reset` dulu).
  const [{ n }] = (await db.select({ n: dsql<number>`count(*)::int` }).from(users)) as [{ n: number }];
  if (n > 0) throw new Error("Tabel users tidak kosong. Jalankan `npm run db:reset` sebelum seed ulang.");

  await db.transaction(async (tx) => {
    // ---------- Categories ----------
    const catRows: { id: string; slug: string; parentId: string | null }[] = [];
    let order = 0;
    for (const parent of categorySeed) {
      const [p] = await tx
        .insert(categories)
        .values({ name: parent.name, slug: parent.slug, sortOrder: order++ })
        .returning();
      catRows.push({ id: p!.id, slug: p!.slug, parentId: null });
      for (const child of parent.children) {
        const [c] = await tx
          .insert(categories)
          .values({ name: child, slug: `${parent.slug}-${slugify(child)}`, parentId: p!.id, sortOrder: order++ })
          .returning();
        catRows.push({ id: c!.id, slug: c!.slug, parentId: p!.id });
      }
    }
    const leafCats = catRows.filter((c) => c.parentId !== null);

    // ---------- Users ----------
    const [admin] = await tx
      .insert(users)
      .values({ name: "Admin Platform", email: "admin@ecommerce.test", emailVerified: true, role: "admin" })
      .returning();

    const sellerUsers = await tx
      .insert(users)
      .values(
        Array.from({ length: 3 }, (_, i) => ({
          name: faker.person.fullName(),
          email: `seller${i + 1}@ecommerce.test`,
          phone: `0812${faker.string.numeric(8)}`,
          emailVerified: true,
          role: "seller" as const,
        })),
      )
      .returning();

    const buyerUsers = await tx
      .insert(users)
      .values(
        Array.from({ length: 6 }, (_, i) => ({
          name: faker.person.fullName(),
          email: `buyer${i + 1}@ecommerce.test`,
          phone: `0857${faker.string.numeric(8)}`,
          emailVerified: true,
        })),
      )
      .returning();

    // Buyer ke-6 nanti mendaftar sebagai seller pending (untuk test approval T-10).
    const pendingSellerUser = buyerUsers[5]!;

    // ---------- Addresses (1 default per user) ----------
    await tx.insert(addresses).values(
      [...buyerUsers, ...sellerUsers].map((u, i) => {
        const c = cities[i % cities.length]!;
        return {
          userId: u.id,
          label: "Rumah",
          recipientName: u.name,
          phone: u.phone ?? "081200000000",
          ...c,
          street: faker.location.streetAddress(),
          isDefault: true,
        };
      }),
    );

    // ---------- Credential accounts (login email+password via Better Auth) ----------
    const passwordHash = await hashPassword(SEED_PASSWORD);
    await tx.insert(accounts).values(
      [admin!, ...sellerUsers, ...buyerUsers].map((u) => ({
        userId: u.id,
        accountId: u.id,
        providerId: "credential",
        password: passwordHash,
      })),
    );

    // ---------- Sellers ----------
    const storeNames = ["Toko Nusantara", "Gadget Corner", "Rumah Cantik"];
    const sellerRows = await tx
      .insert(sellers)
      .values(
        sellerUsers.map((u, i) => {
          const c = cities[i % cities.length]!;
          return {
            userId: u.id,
            storeName: storeNames[i]!,
            slug: slugify(storeNames[i]!),
            description: faker.company.catchPhrase(),
            status: "approved" as const,
            pickupContactName: u.name,
            pickupPhone: u.phone,
            pickupProvince: c.province,
            pickupCity: c.city,
            pickupDistrict: c.district,
            pickupPostalCode: c.postalCode,
            pickupStreet: faker.location.streetAddress(),
            couriers: [...courierSeed],
          };
        }),
      )
      .returning();

    await tx.insert(sellers).values({
      userId: pendingSellerUser.id,
      storeName: "Toko Baru Menunggu",
      slug: "toko-baru-menunggu",
      status: "pending",
    });
    await tx.update(users).set({ role: "seller" }).where(dsql`${users.id} = ${pendingSellerUser.id}`);

    // ---------- Products + Variants ----------
    const productRows: (typeof products.$inferSelect)[] = [];
    const variantRows: (typeof productVariants.$inferSelect)[] = [];

    for (const seller of sellerRows) {
      for (let i = 0; i < 8; i++) {
        const cat = faker.helpers.arrayElement(leafCats);
        const name = faker.commerce.productName();
        const variantCount = faker.number.int({ min: 1, max: 3 });
        const basePrice = rp(faker.number.int({ min: 25_000, max: 750_000 }));

        const variantValues = Array.from({ length: variantCount }, (_, v) => {
          const label = faker.helpers.arrayElement(["S", "M", "L", "XL", "Hitam", "Putih", "Biru"]);
          return {
            sku: `${slugify(seller.storeName).slice(0, 4).toUpperCase()}-${i}-${v}`,
            name: `${label} #${v + 1}`,
            options: { varian: label },
            price: basePrice + v * 5_000,
            stock: faker.number.int({ min: 5, max: 100 }),
          };
        });

        const [p] = await tx
          .insert(products)
          .values({
            sellerId: seller.id,
            categoryId: cat.id,
            name,
            slug: `${slugify(name)}-${faker.string.alphanumeric(5).toLowerCase()}`,
            description: faker.commerce.productDescription(),
            status: "active",
            images: [`https://picsum.photos/seed/${faker.string.alphanumeric(8)}/800/800`],
            minPrice: Math.min(...variantValues.map((v) => v.price)),
            weightGram: faker.number.int({ min: 100, max: 2000 }),
          })
          .returning();
        productRows.push(p!);

        const vs = await tx
          .insert(productVariants)
          .values(variantValues.map((v) => ({ ...v, productId: p!.id })))
          .returning();
        variantRows.push(...vs);
      }
    }

    // ---------- Vouchers ----------
    const now = new Date();
    const day = 86_400_000;
    await tx.insert(vouchers).values([
      { code: "WELCOME10", scope: "platform", type: "percent", value: 10, maxDiscount: 25_000, minPurchase: 50_000, quota: 100, startsAt: new Date(now.getTime() - 30 * day), expiresAt: new Date(now.getTime() + 60 * day) },
      { code: "HEMAT20K", scope: "platform", type: "fixed", value: 20_000, minPurchase: 150_000, quota: 50, startsAt: new Date(now.getTime() - 30 * day), expiresAt: new Date(now.getTime() + 60 * day) },
      { code: "EXPIRED5", scope: "platform", type: "percent", value: 5, quota: 10, startsAt: new Date(now.getTime() - 90 * day), expiresAt: new Date(now.getTime() - 30 * day) },
      { code: "SELLER15", scope: "seller", sellerId: sellerRows[0]!.id, type: "percent", value: 15, minPurchase: 100_000, quota: 20, startsAt: new Date(now.getTime() - 7 * day), expiresAt: new Date(now.getTime() + 30 * day) },
    ]);

    // ---------- Carts ----------
    const cartBuyer = buyerUsers[0]!;
    const [cart] = await tx.insert(carts).values({ userId: cartBuyer.id }).returning();
    // Item dari 2 seller berbeda (untuk test grouping T-06).
    const s0 = variantRows.find((v) => productRows.find((p) => p.id === v.productId)?.sellerId === sellerRows[0]!.id)!;
    const s1 = variantRows.find((v) => productRows.find((p) => p.id === v.productId)?.sellerId === sellerRows[1]!.id)!;
    await tx.insert(cartItems).values([
      { cartId: cart!.id, variantId: s0.id, quantity: 2 },
      { cartId: cart!.id, variantId: s1.id, quantity: 1 },
    ]);

    // ---------- Checkouts / Orders (berbagai status) ----------
    const statuses = ["pending_payment", "paid", "processing", "shipped", "delivered", "completed", "cancelled"] as const;
    const completedItems: (typeof orderItems.$inferSelect)[] = [];
    let seq = 1;

    for (const buyer of buyerUsers.slice(0, 4)) {
      for (const status of faker.helpers.arrayElements(statuses, 3)) {
        const seller = faker.helpers.arrayElement(sellerRows);
        const sellerVariants = variantRows.filter(
          (v) => productRows.find((p) => p.id === v.productId)?.sellerId === seller.id,
        );
        const picks = faker.helpers.arrayElements(sellerVariants, faker.number.int({ min: 1, max: 3 }));
        const lines = picks.map((v) => {
          const p = productRows.find((x) => x.id === v.productId)!;
          const qty = faker.number.int({ min: 1, max: 3 });
          return { v, p, qty, subtotal: v.price * qty };
        });

        const subtotal = lines.reduce((a, l) => a + l.subtotal, 0);
        const shipping = rp(faker.number.int({ min: 9_000, max: 35_000 }));
        const total = subtotal + shipping;
        const paid = status !== "pending_payment" && status !== "cancelled";
        const addr = cities[seq % cities.length]!;
        const invoiceNo = `INV-2026-${String(seq).padStart(5, "0")}`;

        const [co] = await tx
          .insert(checkouts)
          .values({
            userId: buyer.id,
            invoiceNo,
            status: paid ? "paid" : status === "cancelled" ? "cancelled" : "pending",
            subtotal,
            shippingTotal: shipping,
            grandTotal: total,
            paymentMethod: paid ? "VA" : null,
            paidAt: paid ? faker.date.recent({ days: 20 }) : null,
          })
          .returning();

        const [o] = await tx
          .insert(orders)
          .values({
            checkoutId: co!.id,
            orderNo: `ORD-2026-${String(seq).padStart(5, "0")}`,
            userId: buyer.id,
            sellerId: seller.id,
            status,
            shippingAddress: {
              recipientName: buyer.name,
              phone: buyer.phone ?? "081200000000",
              ...addr,
              street: faker.location.streetAddress(),
            },
            courierCode: "jne",
            courierService: "REG",
            subtotal,
            shippingCost: shipping,
            total,
            trackingNumber: ["shipped", "delivered", "completed"].includes(status) ? `JNE${faker.string.numeric(12)}` : null,
            completedAt: status === "completed" ? faker.date.recent({ days: 5 }) : null,
          })
          .returning();

        const items = await tx
          .insert(orderItems)
          .values(
            lines.map((l) => ({
              orderId: o!.id,
              productId: l.p.id,
              variantId: l.v.id,
              productName: l.p.name,
              variantName: l.v.name,
              imageUrl: l.p.images[0] ?? null,
              unitPrice: l.v.price,
              quantity: l.qty,
              subtotal: l.subtotal,
            })),
          )
          .returning();

        if (status === "completed") completedItems.push(...items);
        seq++;
      }
    }

    // Satu voucher usage konsisten (checkout pertama + WELCOME10).
    const [firstCheckout] = await tx.select().from(checkouts).limit(1);
    const [welcome] = await tx.select().from(vouchers).where(dsql`upper(${vouchers.code}) = 'WELCOME10'`);
    if (firstCheckout?.userId && welcome) {
      const discount = Math.min(Math.floor((firstCheckout.subtotal * 10) / 100), welcome.maxDiscount ?? Infinity);
      await tx.insert(voucherUsages).values({
        voucherId: welcome.id,
        userId: firstCheckout.userId,
        checkoutId: firstCheckout.id,
        discount,
      });
      await tx.update(vouchers).set({ usedCount: 1 }).where(dsql`${vouchers.id} = ${welcome.id}`);
    }

    // ---------- Reviews (hanya dari item order completed, 1 per item) ----------
    const reviewedProducts = new Map<string, number[]>();
    for (const item of completedItems) {
      const buyerOrder = await tx.select().from(orders).where(dsql`${orders.id} = ${item.orderId}`);
      const userId = buyerOrder[0]?.userId;
      if (!userId) continue;
      const rating = faker.number.int({ min: 3, max: 5 });
      await tx.insert(reviews).values({
        productId: item.productId,
        orderItemId: item.id,
        userId,
        rating,
        comment: faker.lorem.sentence(),
      });
      reviewedProducts.set(item.productId, [...(reviewedProducts.get(item.productId) ?? []), rating]);
    }
    // Sinkronkan denormalisasi rating produk.
    for (const [productId, ratings] of reviewedProducts) {
      const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
      await tx
        .update(products)
        .set({ ratingAvg: Math.round(avg * 10), ratingCount: ratings.length })
        .where(dsql`${products.id} = ${productId}`);
    }

    // ---------- Wishlist ----------
    await tx.insert(wishlists).values(
      faker.helpers.arrayElements(productRows, 4).map((p) => ({ userId: buyerUsers[1]!.id, productId: p.id })),
    );

    // ---------- Chat ----------
    const [conv] = await tx
      .insert(conversations)
      .values({
        buyerId: buyerUsers[0]!.id,
        sellerId: sellerRows[0]!.id,
        productId: productRows[0]!.id,
        lastMessageAt: new Date(),
        sellerUnread: 1,
      })
      .returning();
    await tx.insert(messages).values([
      { conversationId: conv!.id, senderId: buyerUsers[0]!.id, body: "Halo kak, stok masih ada?" },
      { conversationId: conv!.id, senderId: sellerUsers[0]!.id, body: "Halo, masih ready kak." },
      { conversationId: conv!.id, senderId: buyerUsers[0]!.id, body: "Oke, saya order ya." },
    ]);

    // ---------- Payouts + saldo seller konsisten ----------
    // Saldo seller = total order completed - payout (pending/approved/paid).
    for (const seller of sellerRows) {
      const [{ earned }] = (await tx
        .select({ earned: dsql<number>`coalesce(sum(${orders.total}), 0)::int` })
        .from(orders)
        .where(dsql`${orders.sellerId} = ${seller.id} and ${orders.status} = 'completed'`)) as [{ earned: number }];

      const payoutAmount = Math.floor(earned / 2 / 1000) * 1000;
      if (payoutAmount > 0) {
        await tx.insert(payouts).values({
          sellerId: seller.id,
          amount: payoutAmount,
          status: "pending",
          bankName: faker.helpers.arrayElement(bankSeed),
          accountNumber: faker.string.numeric(10),
          accountHolder: sellerUsers.find((u) => u.id === seller.userId)?.name ?? "Pemilik Toko",
        });
      }
      await tx
        .update(sellers)
        .set({ balance: earned - payoutAmount })
        .where(dsql`${sellers.id} = ${seller.id}`);
    }

    console.log(
      `seed     ok  users=${1 + sellerUsers.length + buyerUsers.length} sellers=${sellerRows.length + 1} ` +
        `categories=${catRows.length} products=${productRows.length} variants=${variantRows.length} ` +
        `orders=${seq - 1} reviews=${completedItems.length}`,
    );
    console.log(`login    admin@ecommerce.test / seller1@ecommerce.test / buyer1@ecommerce.test  (password: ${SEED_PASSWORD})`);
  });
}

try {
  await main();
} catch (error) {
  console.error("seed     gagal:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
