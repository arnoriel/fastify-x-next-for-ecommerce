"use client";

import {
  myReviewSchema,
  orderReviewsResponseSchema,
  productReviewsResponseSchema,
  type MyReview,
  type OrderReviewsResponse,
  type ProductReviewsQuery,
  type ProductReviewsResponse,
  type ReviewInput,
} from "@ecommerce/shared";
import { apiRequest } from "@/lib/http";

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function listProductReviews(
  slug: string,
  query: Partial<ProductReviewsQuery> = {},
): Promise<ProductReviewsResponse> {
  return productReviewsResponseSchema.parse(
    await apiRequest(`/api/products/${encodeURIComponent(slug)}/reviews`, { query }),
  );
}

export async function getOrderReviews(orderId: string): Promise<OrderReviewsResponse> {
  return orderReviewsResponseSchema.parse(await apiRequest(`/api/orders/${encodeURIComponent(orderId)}/reviews`));
}

export async function createReview(orderItemId: string, input: ReviewInput): Promise<MyReview> {
  return myReviewSchema.parse(
    await apiRequest(`/api/order-items/${encodeURIComponent(orderItemId)}/review`, json("POST", input)),
  );
}

export async function updateReview(reviewId: string, input: ReviewInput): Promise<MyReview> {
  return myReviewSchema.parse(await apiRequest(`/api/reviews/${encodeURIComponent(reviewId)}`, json("PATCH", input)));
}
