import Link from "next/link";
import { FaBagShopping } from "react-icons/fa6";
import type { Category } from "@ecommerce/shared";

const BENTO_SPAN = [
  "sm:col-span-2 sm:row-span-2", // hero cell
  "",
  "",
  "sm:col-span-2",
  "",
  "",
] as const;

export function CategoryBento({ categories }: { categories: Category[] }) {
  const roots = categories.filter((c) => !c.parentId).slice(0, 6);

  if (roots.length === 0) {
    return (
      <div className="glass flex min-h-[120px] items-center justify-center p-6 text-center text-sm text-[var(--muted)]">
        Kategori belum tersedia.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:[grid-auto-rows:8rem]">
      {roots.map((category, i) => (
        <Link
          key={category.id}
          href={`/?categoryId=${category.id}`}
          className={`bento-cell group relative flex flex-col justify-end overflow-hidden p-4 ${BENTO_SPAN[i] ?? ""}`}
        >
          <span className="pointer-events-none absolute -right-4 -top-4 text-6xl opacity-10 transition-transform duration-300 group-hover:scale-110" aria-hidden>
            {category.iconUrl ? null : <FaBagShopping size={56} />}
          </span>
          <span className="relative text-sm font-semibold text-[var(--fg)] sm:text-base">{category.name}</span>
        </Link>
      ))}
    </div>
  );
}