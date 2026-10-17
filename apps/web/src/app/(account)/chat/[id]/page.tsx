import type { Metadata } from "next";
import Link from "next/link";
import { ChatThread } from "@/components/chat/chat-thread";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Chat" };
export const dynamic = "force-dynamic";

export default async function ChatThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser({ next: `/chat/${encodeURIComponent(id)}` });

  return (
    <div className="flex flex-col gap-3">
      <Link href="/chat" className="btn-ghost w-fit !px-2">
        Semua chat
      </Link>
      {/* key = id: pindah percakapan (mis. dari notifikasi) mereset seluruh state thread. */}
      <ChatThread key={id} conversationId={id} variant="page" />
    </div>
  );
}
