import type Anthropic from "@anthropic-ai/sdk";
import { getDefaultStore } from "jotai";
import { streamChat, type ChatEvent } from "../lib/api";
import { chatFamily } from "../store/chats";
import type { Turn } from "../components/Chat";
import type { LearnTopic } from "../components/LearnPanel";

type Store = ReturnType<typeof getDefaultStore>;

// TODO(i18n): SEARCH_ERRORS strings are not localized because they live in a
// store writer, not a React tree. Move the code → user-facing text mapping
// into the Chat component (via intl.formatMessage) to localize.
const SEARCH_ERRORS: Record<string, string> = {
  max_uses_exceeded: "Hit the web search limit for this message.",
  too_many_requests: "Web search was rate limited.",
  query_too_long: "That search query was too long.",
  unavailable: "Web search is temporarily unavailable.",
  invalid_tool_input: "Web search rejected the query.",
  request_too_large: "The search request was too large.",
};

function titleFromPrompt(prompt: string): string {
  const line = prompt.trim().split("\n", 1)[0]!.trim();
  return line.length > 42 ? `${line.slice(0, 41)}…` : line || "New chat";
}

const newTurn = (id: string, role: Turn["role"], text: string): Turn => ({
  id,
  role,
  text,
  thinking: "",
  searches: [],
  citations: [],
});

/** The API is stateless — rebuild the full history from the visible turns each send. */
const toMessageParams = (turns: Turn[]): Anthropic.MessageParam[] =>
  turns
    .filter((t) => t.text.trim().length > 0)
    .map((t) => ({ role: t.role, content: t.text }));

function patchTurn(
  store: Store,
  chatId: string,
  turnId: string,
  change: (t: Turn) => Partial<Turn>,
): void {
  store.set(chatFamily(chatId), (prev) => ({
    ...prev,
    turns: prev.turns.map((t) => (t.id === turnId ? { ...t, ...change(t) } : t)),
  }));
}

function updateOffers(
  store: Store,
  chatId: string,
  updater: (offers: LearnTopic[]) => LearnTopic[],
): void {
  store.set(chatFamily(chatId), (prev) => ({ ...prev, offers: updater(prev.offers) }));
}

function applyEvent(store: Store, chatId: string, assistantId: string, event: ChatEvent): void {
  switch (event.type) {
    case "text":
      patchTurn(store, chatId, assistantId, (turn) => ({ text: turn.text + event.text }));
      break;
    case "thinking":
      patchTurn(store, chatId, assistantId, (turn) => ({ thinking: turn.thinking + event.text }));
      break;
    case "search":
      patchTurn(store, chatId, assistantId, (turn) => ({
        searches: [...turn.searches, { query: event.query, results: [] }],
      }));
      break;
    case "search_results":
      patchTurn(store, chatId, assistantId, (turn) => ({
        searches: turn.searches.map((search, index) =>
          index === turn.searches.length - 1 ? { ...search, results: event.results } : search,
        ),
      }));
      break;
    case "search_error":
      patchTurn(store, chatId, assistantId, (turn) => ({
        searches: turn.searches.map((search, index) =>
          index === turn.searches.length - 1
            ? { ...search, error: SEARCH_ERRORS[event.code] ?? `Web search failed (${event.code}).` }
            : search,
        ),
      }));
      break;
    case "background": {
      const hasHands = !!event.practiceQueries;
      const hasQuiz = event.includeQuiz;
      updateOffers(store, chatId, (current) => [
        ...current,
        {
          id: event.id,
          topic: event.topic,
          reason: event.reason,
          links: [],
          videos: [],
          read: { status: "gathering" },
          watch: { status: "gathering" },
          ...(hasHands ? { practice: [], practiceStatus: { status: "gathering" as const } } : {}),
          ...(hasQuiz ? { quiz: [], quizStatus: { status: "gathering" as const } } : {}),
        },
      ]);
      break;
    }
    case "background_progress":
      updateOffers(store, chatId, (current) =>
        current.map((offer) => {
          if (offer.id !== event.id) return offer;
          if (event.kind === "practice") {
            return {
              ...offer,
              practiceStatus: {
                status: offer.practiceStatus?.status ?? "gathering",
                ...offer.practiceStatus,
                activity: event.activity,
              },
            };
          }
          if (event.kind === "quiz") {
            return {
              ...offer,
              quizStatus: {
                status: offer.quizStatus?.status ?? "gathering",
                ...offer.quizStatus,
                activity: event.activity,
              },
            };
          }
          return { ...offer, [event.kind]: { ...offer[event.kind], activity: event.activity } };
        }),
      );
      break;
    case "background_links":
      updateOffers(store, chatId, (current) =>
        current.map((offer) =>
          offer.id === event.id ? { ...offer, links: event.links, read: { status: "ready" } } : offer,
        ),
      );
      break;
    case "background_videos":
      updateOffers(store, chatId, (current) =>
        current.map((offer) =>
          offer.id === event.id ? { ...offer, videos: event.videos, watch: { status: "ready" } } : offer,
        ),
      );
      break;
    case "background_practice":
      updateOffers(store, chatId, (current) =>
        current.map((offer) =>
          offer.id === event.id
            ? { ...offer, practice: event.items, practiceStatus: { status: "ready" } }
            : offer,
        ),
      );
      break;
    case "background_quiz":
      updateOffers(store, chatId, (current) =>
        current.map((offer) =>
          offer.id === event.id
            ? { ...offer, quiz: event.questions, quizStatus: { status: "ready" } }
            : offer,
        ),
      );
      break;
    case "background_error":
      updateOffers(store, chatId, (current) =>
        current.map((offer) => {
          if (offer.id !== event.id) return offer;
          if (event.kind === "practice")
            return { ...offer, practiceStatus: { status: "error", error: event.message } };
          if (event.kind === "quiz")
            return { ...offer, quizStatus: { status: "error", error: event.message } };
          return { ...offer, [event.kind]: { status: "error", error: event.message } };
        }),
      );
      break;
    case "citation":
      patchTurn(store, chatId, assistantId, (turn) =>
        turn.citations.some((source) => source.url === event.url)
          ? {}
          : { citations: [...turn.citations, { url: event.url, title: event.title }] },
      );
      break;
    case "done":
      // TODO(i18n): the `note` string below and `refusal` fallbacks are not
      // localized because they're written from a store writer, not a React
      // tree. Format at render time in Chat.tsx if we need localization.
      if (event.refusal) patchTurn(store, chatId, assistantId, () => ({ error: event.refusal }));
      else if (event.truncated)
        patchTurn(store, chatId, assistantId, () => ({
          note: "Stopped early — this answer needed more search steps.",
        }));
      break;
    case "error":
      patchTurn(store, chatId, assistantId, () => ({ error: event.message }));
      break;
  }
}

export async function sendMessage(
  store: Store,
  chatId: string,
  text: string,
  webSearch: boolean,
  signal: AbortSignal,
): Promise<void> {
  const atom = chatFamily(chatId);
  const before = store.get(atom);
  const isFirst = before.turns.length === 0;

  const userTurn = newTurn(crypto.randomUUID(), "user", text);
  const assistantId = crypto.randomUUID();
  const assistantTurn = newTurn(assistantId, "assistant", "");

  store.set(atom, (prev) => ({
    ...prev,
    title: isFirst ? titleFromPrompt(text) : prev.title,
    turns: [...prev.turns, userTurn, assistantTurn],
  }));

  const history = [...before.turns, userTurn];

  try {
    for await (const event of streamChat(toMessageParams(history), webSearch, signal)) {
      applyEvent(store, chatId, assistantId, event);
    }
  } catch (cause) {
    if (signal.aborted) return;
    patchTurn(store, chatId, assistantId, () => ({
      error: cause instanceof Error ? cause.message : "The stream failed.",
    }));
  }
}
