import { storeConfig } from "@ecommerce/shared";

/** Footer ringkas: kontak dari config + hak cipta. Entri kontak yang kosong tidak dirender. */
export function StoreFooter() {
  const { storeName, contact } = storeConfig;
  const entries = [
    contact.email && { label: contact.email, href: `mailto:${contact.email}` },
    contact.phone && { label: contact.phone, href: `tel:${contact.phone.replace(/[^\d+]/g, "")}` },
    contact.whatsapp && { label: "WhatsApp", href: `https://wa.me/${contact.whatsapp}` },
  ].filter((e): e is { label: string; href: string } => Boolean(e));

  return (
    <footer className="mt-4 flex flex-col gap-1 border-t border-[var(--border)] pt-4 text-center">
      {(entries.length > 0 || contact.address) && (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm">
          {entries.map((e) => (
            <a key={e.href} href={e.href} className="hover:underline">
              {e.label}
            </a>
          ))}
          {contact.address && <span className="muted">{contact.address}</span>}
        </div>
      )}
      <p className="muted small">
        © {new Date().getFullYear()} {storeName}
      </p>
    </footer>
  );
}
