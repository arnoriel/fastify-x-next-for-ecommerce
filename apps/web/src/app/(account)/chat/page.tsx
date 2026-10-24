import type { Metadata } from "next";
import { ChatListView } from "@/components/chat/chat-list-view";
import { requireFeature } from "@/lib/features";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Chat" };
export const dynamic = "force-dynamic";

export default async function ChatListPage() {
  requireFeature("chat");
  await requireUser({ next: "/chat" });
  return <ChatListView />;
}
