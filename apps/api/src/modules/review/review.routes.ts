/**
 * T-12: review & rating.
 *   GET   /api/products/:slug/reviews    publik — daftar + ringkasan (?page, ?pageSize, ?rating)
 *   GET   /api/orders/:id/reviews        review milik buyer pada order ini + apakah boleh mereview
 *   POST  /api/order-items/:id/review    beri review (order completed, 1 per item)
 *   PATCH /api/reviews/:id               ubah review (dalam jendela waktu)
 */

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { productReviewsQuerySchema, reviewInputSchema } from "@ecommerce/shared";
import { requireAuth } from "../../plugins/auth";
import { createReview, getOrderReviews, listProductReviews, updateReview } from "./review.service";

const idParams = z.object({ id: z.string().min(1) });
const slugParams = z.object({ slug: z.string().min(1) });

export const reviewRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/products/:slug/reviews", async (req) => {
    const { slug } = slugParams.parse(req.params);
    return listProductReviews(slug, productReviewsQuerySchema.parse(req.query));
  });

  app.get("/api/orders/:id/reviews", { preHandler: requireAuth }, async (req) => {
    const { id } = idParams.parse(req.params);
    return getOrderReviews(req.user!.id, id);
  });

  app.post("/api/order-items/:id/review", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const review = await createReview(req.user!.id, id, reviewInputSchema.parse(req.body));
    reply.code(201);
    return review;
  });

  app.patch("/api/reviews/:id", { preHandler: requireAuth }, async (req) => {
    const { id } = idParams.parse(req.params);
    return updateReview(req.user!.id, id, reviewInputSchema.parse(req.body));
  });
};
