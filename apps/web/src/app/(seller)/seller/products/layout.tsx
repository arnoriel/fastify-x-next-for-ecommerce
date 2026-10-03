import type { ReactNode } from "react";

/** Form produk tetap sempit (layout seller sekarang selebar dashboard). */
export default function SellerProductsLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[720px]">{children}</div>;
}
