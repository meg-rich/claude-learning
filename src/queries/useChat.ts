import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { fetchChat, type ChatRecord } from "../lib/api";
import { chatFamily } from "../store/chats";
import type { Turn } from "../components/Chat";
import type { LearnTopic } from "../components/LearnPanel";

export function useChat(id: string | null) {
  const query = useQuery<ChatRecord>({
    queryKey: ["chat", id],
    queryFn: () => fetchChat(id!),
    enabled: id !== null,
  });
  const setDoc = useSetAtom(id ? chatFamily(id) : chatFamily("__noop"));

  useEffect(() => {
    if (!id || !query.data) return;
    setDoc((prev) => {
      if (prev.hydrated) return prev;
      return {
        id,
        title: query.data.title,
        turns: (query.data.turns as Turn[]) ?? [],
        offers: (query.data.offers as LearnTopic[]) ?? [],
        createdAt: query.data.createdAt,
        updatedAt: query.data.updatedAt,
        hydrated: true,
      };
    });
  }, [id, query.data, setDoc]);

  return query;
}
