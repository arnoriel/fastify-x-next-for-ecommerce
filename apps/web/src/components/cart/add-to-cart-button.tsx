"use client";

import { useState } from "react";
import { FaCartPlus } from "react-icons/fa6";
import { useCartStore } from "@/lib/cart-store";

export function AddToCartButton({ variantId, disabled }: { variantId: string; disabled?: boolean }) {
  const add = useCartStore((s) => s.add);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    setStatus("loading");
    setMessage(null);
    try {
      await add(variantId, 1);
      setStatus("done");
      setTimeout(() => setStatus("idle"), 1500);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Gagal menambah ke keranjang.");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button type="button" className="btn" disabled={disabled || status === "loading"} onClick={() => void handleClick()}>
        <FaCartPlus aria-hidden />
        {status === "loading" ? "Menambahkan..." : status === "done" ? "Ditambahkan!" : "Tambah ke keranjang"}
      </button>
      {message && <span className="field-error">{message}</span>}
    </div>
  );
}
