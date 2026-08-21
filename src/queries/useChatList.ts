import { useQuery } from "@tanstack/react-query";
import { listChats, type ChatSummary } from "../lib/api";

export function useChatList(enabled: boolean) {
  return useQuery<ChatSummary[]>({
    queryKey: ["chats"],
    queryFn: listChats,
    enabled,
  });
}
