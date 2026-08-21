import { useEffect } from "react";
import { useStore } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { chatFamily, chatIdsAtom } from "./chats";
import { patchChat, type ChatSummary } from "../lib/api";

const DEBOUNCE_MS = 700;

export function useSaveEffect() {
  const store = useStore();
  const qc = useQueryClient();

  useEffect(() => {
    // Per-id subscription lifetime is driven by chatIdsAtom mutations only —
    // NOT by React re-renders. We subscribe to the ids atom itself and
    // manage a stable Map of per-id unsubs so a sidebar reorder doesn't
    // tear down all subscriptions.
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const lastSaved = new Map<string, string>();
    const perId = new Map<string, () => void>();

    const subscribeId = (id: string) => {
      if (perId.has(id)) return;
      const atom = chatFamily(id);
      const seed = store.get(atom);
      // If the atom is already hydrated (e.g., another observer hydrated it
      // before we subscribed), seed lastSaved so the first sub notification
      // doesn't fire a redundant PATCH.
      if (seed.hydrated) lastSaved.set(id, snapshot(seed));
      const unsub = store.sub(atom, () => {
        const doc = store.get(atom);
        if (!doc.hydrated) return;
        // First hydration for this id: seed lastSaved and skip the PATCH.
        // Query just fetched this exact payload, no need to write it back.
        if (!lastSaved.has(id)) {
          lastSaved.set(id, snapshot(doc));
          return;
        }
        const snap = snapshot(doc);
        if (lastSaved.get(id) === snap) return;
        const existing = timers.get(id);
        if (existing) clearTimeout(existing);
        timers.set(
          id,
          setTimeout(() => {
            timers.delete(id);
            lastSaved.set(id, snap);
            patchChat(id, { title: doc.title, turns: doc.turns, offers: doc.offers })
              .then((chat) => {
                qc.setQueryData<ChatSummary[]>(["chats"], (prev) =>
                  prev
                    ? prev
                        .map((c) =>
                          c.id === chat.id
                            ? { ...c, title: chat.title, updatedAt: chat.updatedAt }
                            : c,
                        )
                        .sort((a, b) => b.updatedAt - a.updatedAt)
                    : prev,
                );
                qc.setQueryData(["chat", chat.id], chat);
              })
              .catch(() => {
                // Transient. Next mutation re-saves the full payload.
                lastSaved.delete(id);
              });
          }, DEBOUNCE_MS),
        );
      });
      perId.set(id, unsub);
    };

    const reconcile = () => {
      const next = new Set(store.get(chatIdsAtom));
      for (const id of next) subscribeId(id);
      for (const [id, unsub] of perId) {
        if (!next.has(id)) {
          unsub();
          perId.delete(id);
          const t = timers.get(id);
          if (t) clearTimeout(t);
          timers.delete(id);
          lastSaved.delete(id);
        }
      }
    };

    reconcile();
    const unsubIds = store.sub(chatIdsAtom, reconcile);

    return () => {
      unsubIds();
      for (const [, unsub] of perId) unsub();
      for (const [, t] of timers) clearTimeout(t);
    };
  }, [store, qc]);
}

function snapshot(doc: { title: string; turns: unknown[]; offers: unknown[] }): string {
  return JSON.stringify({ t: doc.title, u: doc.turns, o: doc.offers });
}
