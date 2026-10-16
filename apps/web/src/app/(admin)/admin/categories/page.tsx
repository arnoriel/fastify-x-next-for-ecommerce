import type { Metadata } from "next";
import { CategoriesView } from "@/components/admin/categories-view";

export const metadata: Metadata = { title: "Kelola Kategori" };
export const dynamic = "force-dynamic";

export default function AdminCategoriesPage() {
  return <CategoriesView />;
}
