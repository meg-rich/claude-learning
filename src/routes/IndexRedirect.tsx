import { useEffect, useRef } from "react";
import { FormattedMessage } from "react-intl";
import { useNavigate } from "react-router-dom";
import { useChatList } from "../queries/useChatList";
import { useChatMutations } from "../mutations/useChatMutations";
import { useAuth } from "../queries/useAuth";

export function IndexRedirect() {
  const nav = useNavigate();
  const auth = useAuth().data;
  const list = useChatList(auth?.authenticated === true);
  const { create } = useChatMutations();
  // StrictMode double-invokes effects; without this guard we'd POST /chats
  // twice when the account is empty.
  const dispatchedRef = useRef(false);

  useEffect(() => {
    if (!list.data || dispatchedRef.current) return;
    dispatchedRef.current = true;
    if (list.data.length === 0) {
      void create
        .mutateAsync()
        .then((chat) => nav(`/chats/${chat.id}`, { replace: true }))
        .catch(() => {
          dispatchedRef.current = false;
        });
    } else {
      nav(`/chats/${list.data[0]!.id}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data]);

  return (
    <div className="centered muted">
      <FormattedMessage defaultMessage="Loading…" />
    </div>
  );
}
