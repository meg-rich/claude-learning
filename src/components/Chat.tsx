import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { FormattedMessage, defineMessages, useIntl } from "react-intl";
import { useAtomValue, useStore } from "jotai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Source } from "../lib/api";
import { chatFamily } from "../store/chats";
import { beginCourse } from "../store/courseJobs";
import { sendMessage } from "../streams/streamChatToAtom";
import { LearnPanel } from "./LearnPanel";

const msgs = defineMessages({
  composerPlaceholder: {
    defaultMessage: "Message Claude…   (Enter to send, Shift+Enter for a new line)",
  },
  messageAria: { defaultMessage: "Message" },
  respondingAria: { defaultMessage: "Claude is responding" },
});

export type Search = { query: string; results: Source[]; error?: string };

export type Turn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  thinking: string;
  searches: Search[];
  citations: Source[];
  error?: string;
  note?: string;
};

type ChatProps = {
  chatId: string;
};

export function Chat({ chatId }: ChatProps) {
  const intl = useIntl();
  const store = useStore();
  const doc = useAtomValue(chatFamily(chatId));
  const turns = doc.turns;
  const offers = doc.offers;

  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [webSearch, setWebSearch] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  async function send() {
    const prompt = draft.trim();
    if (!prompt || streaming) return;
    setDraft("");
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await sendMessage(store, chatId, prompt, webSearch, controller.signal);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <>
      <div className="transcript">
        {turns.length === 0 && (
          <div className="empty">
            <h2>
              <FormattedMessage defaultMessage="What are we working on?" />
            </h2>
            <p className="muted">
              {webSearch ? (
                <FormattedMessage defaultMessage="Streaming from {model} with adaptive thinking and web search." values={{ model: "claude-opus-4-7" }} />
              ) : (
                <FormattedMessage defaultMessage="Streaming from {model} with adaptive thinking." values={{ model: "claude-opus-4-7" }} />
              )}
            </p>
          </div>
        )}

        {turns.map((turn) => (
          <article key={turn.id} className={`turn ${turn.role}`}>
            <div className="role">
              {turn.role === "user" ? (
                <FormattedMessage defaultMessage="You" />
              ) : (
                <FormattedMessage defaultMessage="Claude" />
              )}
            </div>
            <div className="body">
              {turn.thinking && (
                <details className="thinking">
                  <summary>
                    <FormattedMessage defaultMessage="Thinking" />
                  </summary>
                  <pre>{turn.thinking}</pre>
                </details>
              )}

              {turn.searches.map((search, index) => (
                <details key={index} className="search">
                  <summary>
                    <span className="glyph" aria-hidden="true">
                      ⌕
                    </span>
                    {search.query ? (
                      <FormattedMessage
                        defaultMessage="Searched “{query}”"
                        values={{ query: search.query }}
                      />
                    ) : (
                      <FormattedMessage defaultMessage="Searched the web" />
                    )}
                    {search.results.length > 0 && (
                      <span className="muted small">
                        {" "}
                        <FormattedMessage
                          defaultMessage="· {count, plural, one {# result} other {# results}}"
                          values={{ count: search.results.length }}
                        />
                      </span>
                    )}
                  </summary>
                  {search.error ? (
                    <p className="error small">{search.error}</p>
                  ) : (
                    <ul>
                      {search.results.map((result) => (
                        <li key={result.url}>
                          <a href={result.url} target="_blank" rel="noreferrer noopener">
                            {result.title || result.url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              ))}

              {turn.text &&
                (turn.role === "assistant" ? (
                  <div className="text markdown">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ node: _node, ...props }) => (
                          <a {...props} target="_blank" rel="noreferrer noopener" />
                        ),
                      }}
                    >
                      {turn.text}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <pre className="text">{turn.text}</pre>
                ))}

              {!turn.text && turn.role === "assistant" && !turn.error && (
                <span
                  className="cursor"
                  aria-label={intl.formatMessage(msgs.respondingAria)}
                />
              )}

              {turn.citations.length > 0 && (
                <div className="sources">
                  <span className="muted small">
                    <FormattedMessage defaultMessage="Sources" />
                  </span>
                  <ol>
                    {turn.citations.map((source) => (
                      <li key={source.url}>
                        <a href={source.url} target="_blank" rel="noreferrer noopener">
                          {source.title}
                        </a>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {turn.note && <p className="muted small">{turn.note}</p>}
              {turn.error && <p className="error">{turn.error}</p>}
            </div>
          </article>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="composer">
        <div className="row">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={intl.formatMessage(msgs.composerPlaceholder)}
            rows={1}
            aria-label={intl.formatMessage(msgs.messageAria)}
          />
          {streaming ? (
            <button type="button" className="stop" onClick={() => abortRef.current?.abort()}>
              <FormattedMessage defaultMessage="Stop" />
            </button>
          ) : (
            <button type="button" onClick={() => void send()} disabled={draft.trim().length === 0}>
              <FormattedMessage defaultMessage="Send" />
            </button>
          )}
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={webSearch}
            onChange={(event) => setWebSearch(event.target.checked)}
          />
          <FormattedMessage defaultMessage="Search the web" />
          <span className="muted small">
            <FormattedMessage defaultMessage="— Claude decides when it needs to" />
          </span>
        </label>
      </div>

      <LearnPanel
        offers={offers}
        onDismiss={() => store.set(chatFamily(chatId), (prev) => ({ ...prev, offers: [] }))}
        onGenerateCourse={(topic) => void beginCourse(store, topic)}
      />
    </>
  );
}
