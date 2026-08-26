# claude-learning

A minimal Claude chat app with a twist: a **background panel** that quietly
gathers reading, videos, and quizzes on whatever the conversation drifts into.

Stack: React + Vite front end, Express API, streaming responses from the
Anthropic Messages API.

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:5173> and paste an Anthropic API key
(from console.anthropic.com).

Prefer no sign-in screen? Copy the env file and set your key there —
the server authenticates every request itself:

```bash
cp .env.example .env
# then edit ANTHROPIC_API_KEY
```

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite (5173) + API (3001), both watching |
| `npm run build` | Typecheck and bundle to `dist/` |
| `npm start` | Production: one process serving `dist/` and the API |
| `npm run typecheck` | `tsc -b` |
| `npm run lint` | `oxlint` |

## Features

- **Streaming chat** with adaptive thinking, shown in a collapsible block.
- **Web search** — Claude can search mid-answer, with sources listed below.
- **Background panel** — floats bottom-right, offers reading/videos/quizzes
  on terms you might not know yet.
- **Stop button** — cancels in-flight requests so you stop being billed.

---

## How auth works

**The API key never touches the browser.**

1. Browser POSTs the key to `/api/auth/login`.
2. Server verifies it with `models.list({ limit: 1 })` — the cheapest
   authenticated call, no tokens billed. A bad key fails immediately, not
   at first message.
3. Server holds the key in memory and hands back an opaque session id
   as an httpOnly, SameSite=Lax cookie. Only the last four characters
   of the key are ever returned (for display).
4. `/api/chat` looks the key up per request. The browser only ever
   holds a cookie it cannot read.

Sessions live in an in-memory `Map`, so a server restart signs everyone
out. Fine for local dev; production would need a shared store with expiry
and `secure` cookies behind TLS (already conditional on `NODE_ENV=production`).

## How chat works

`POST /api/chat` takes the full conversation and streams back Server-Sent
Events. The Messages API is stateless, so the client resends the whole
history each turn.

- **Model:** `claude-opus-4-7`
- **Thinking:** `display: "summarized"`, `effort: "medium"` — keeps replies
  from being unnecessarily verbose. Rendered in a collapsible block above
  each response.
- **`max_tokens: 64000`** — safe because it streams.
- **Abort handling:** clicking Stop (or navigating away) propagates an
  `AbortSignal` into the SDK call, so a cancelled response stops being
  billed rather than running to completion unwatched.
- **Errors:** caught by typed class (`AuthenticationError`, `RateLimitError`,
  `APIError`) and sent as a terminal `error` event, never a raw stack trace.

## Web search

Claude can search the internet mid-answer via the server-side
`web_search_20260209` tool.

- Toggle under the composer turns it on (default) or off per message.
- When on, Claude decides for itself whether a question needs a search.
- Runs on Anthropic's infra — no client-side tool loop, no separate
  search API key.

**Three extra event kinds** stream to the UI:

- The query Claude ran
- The results it got back
- The citations attached to the answer text

Searches appear as collapsible rows above the response; cited pages are
deduplicated into a **Sources** list beneath it.

### Two failure modes handled explicitly

Both are silent otherwise:

- **`pause_turn`** — the server-side tool loop stops after its iteration
  limit and returns `stop_reason: "pause_turn"`, not an error. The turn
  is resumed by echoing the assistant message back (up to
  `MAX_CONTINUATIONS`). Without that, the answer truncates with no
  warning. If the cap is reached, the UI says so rather than presenting
  a partial answer as complete.
- **Search errors** — arrive as HTTP 200 with an error object in place
  of the result array (`max_uses_exceeded`, `too_many_requests`, …), so
  they're detected by branching on the result shape, not by catching
  an exception.

`MAX_SEARCHES` caps searches per message at 8.

---

## The background panel

The floating panel, bottom right, is the app's main idea: reading on
whatever the conversation has drifted into — for the moment you're
following an answer but not the term it rests on.

### Why it doesn't poll

Nothing polls, and no extra call is made on a turn where nobody needs
it. The chat model is already reading the conversation to answer it,
so it's the cheapest available judge of whether the person it's
answering has lost the thread.

It gets one custom tool, `offer_background`, whose description carries
the whole policy: **call it when the user asks what something means,
says they're new to it, or is about to be handed a technology they
haven't used** — not for terms they've already used correctly, and
at most once per reply.

### What happens when Claude calls it

1. The tool result goes back immediately
   (`"Opened. …carry on with your answer"`), so the streaming answer
   never stops to wait.
2. A `background` event opens the panel with the topic and one line
   on why it might help.
3. Two cheaper calls run in parallel (Haiku 4.5, no thinking):
   - One searches the web for reading, filed through a forced
     `report_links` tool.
   - The other restricts search to `youtube.com`, filed through
     `report_videos`.

`tool_choice: "any"` is what makes the output structured — each model
can only reply by searching or filing its report, never by writing
prose someone has to parse. Haiku is the right tier here: the task is
small ("find URLs, describe each in a line"), so Opus's thinking
would be paying for depth we don't need.

All gathers run alongside the answer rather than blocking it, so
the panel fills in while the reply is still being written. The
`done` event is held back until they settle — that keeps "the turn
is finished" meaning the whole exchange, not just the prose.

### Tabs

**Watch** and **Read** are always present. **Practice** appears only
when Claude opted in via one of two signals on `offer_background`:

- **`practice_queries: string[]`** — for topics you learn by **building**
  (React hooks, Terraform, SQL joins). Tab gets mixed videos, articles,
  and interactive sandboxes.
- **`include_quiz: true`** — for topics you learn by **recall** (CAP
  theorem, time complexity, HTTP status codes). Tab gets a short MCQ
  quiz Claude wrote itself, with an explanation on every option —
  right or wrong — so a guess still teaches. The quiz runs in-panel:
  one question at a time, click to reveal, Next to advance, final
  score at the end.

Both signals are independent — a topic can trigger neither, one, or
both. When both fire, the quiz sits above the hands-on section under
a "Check yourself" header.

The Watch tab defers loading the YouTube iframe until you click a
thumbnail, so opening the panel doesn't pull in five video players.

### Other details

- The panel **rides on the web search toggle** — gathering its links
  means searching, so untick "Search the web" and Claude isn't offered
  the tool at all.
- Links are dropped unless they're `http(s)` URLs the search actually
  returned.
- Topics accumulate for the session: newest takes the panel, earlier
  ones stay one click away, and the chevron collapses everything
  to a pill.

---

## Project layout

```
server/index.ts        Express API: auth, session store, SSE chat proxy
server/turn.ts         One assistant turn: streaming, tool loop, event shapes
server/background.ts   Topic -> reading links, via search + a forced tool
src/lib/api.ts         Typed fetch wrappers + SSE parsing
src/components/        SignIn (key gate), Chat (transcript + composer),
                       BackgroundPanel (bottom-right panel)
src/App.tsx            Auth gate — SignIn or Chat
```

## Known gaps

- Responses render as plain text — no markdown or syntax highlighting.
- No conversation persistence — reload starts a fresh thread.
- No attachments, no retry-on-failed-turn.
- Web search is the only tool; no web *fetch*, so Claude sees search
  result snippets rather than full page contents.
- Background panel is per-session and in-memory: reload loses the
  topics it has collected, and there's no way to ask for background
  on a topic Claude didn't offer one for.
