import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createChat,
  deleteChat,
  type ChatRecord,
  type ChatSummary,
} from "../lib/api";
import { router } from "../app/router";

export function useChatMutations() {
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: createChat,
    onSuccess: (chat: ChatRecord) => {
      const summary: ChatSummary = {
        id: chat.id,
        title: chat.title,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
      };
      qc.setQueryData<ChatSummary[]>(["chats"], (prev) =>
        prev ? [summary, ...prev] : [summary],
      );
      qc.setQueryData(["chat", chat.id], chat);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteChat(id),
    onMutate: (id) => {
      const prev = qc.getQueryData<ChatSummary[]>(["chats"]);
      qc.setQueryData<ChatSummary[]>(["chats"], (current) =>
        current ? current.filter((c) => c.id !== id) : current,
      );
      return { prev };
    },
    onError: (_err, _id, context) => {
      if (context?.prev !== undefined) {
        qc.setQueryData(["chats"], context.prev);
      }
    },
    onSuccess: (_data, id) => {
      if (window.location.pathname === `/chats/${id}`) {
        void router.navigate("/", { replace: true });
      }
    },
  });

  return { create, remove };
}
