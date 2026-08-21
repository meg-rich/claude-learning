# claude-background

A minimal Claude chat surface: React + Vite front end, Express API, streaming
responses from the Anthropic Messages API.

## Running it

```bash
npm install
npm run dev
```

Open http://localhost:5173 and paste an Anthropic API key (from
console.anthropic.com). Alternatively, `cp .env.example .env` and set
`ANTHROPIC_API_KEY` there — the server then authenticates every request itself
and the sign-in screen is skipped.

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite (5173) + the API (3001) together, both watching |
| `npm run build` | Typecheck and bundle to `dist/` |
| `npm start` | Production: one process serving `dist/` and the API |
| `npm run typecheck` / `npm run lint` | `tsc -b` / oxlint |

## How auth works

The API key is never exposed to the browser.

1. The browser POSTs the key to `/api/auth/login`.
2. The server verifies it with `models.list({ limit: 1 })` — the cheapest
   authenticated call, no tokens billed — so a bad key is rejected immediately
   rather than at first message.
3. The key is held in the server process and handed back an opaque session id,
   set as an httpOnly, SameSite=Lax cookie. Only the last four characters are
   ever returned to the client, for display.
4. `/api/chat` looks the key up per request. The browser only ever holds a
   cookie it cannot read.

Sessions live in an in-memory `Map`, so a server restart signs everyone out.
That is the right trade-off for local development; a real deployment would move
them to a shared store with expiry, and set `secure` cookies behind TLS
(already conditional on `NODE_ENV=production`).

## How chat works

`POST /api/chat` takes the full conversation and streams back Server-Sent
Events. The Messages API is stateless, so the client resends the whole history
each turn.

- Model `claude-opus-4-7` with adaptive thinking (`display: "summarized"`) and
  `effort: "medium"` to keep replies from being unnecessarily verbose, which
  the UI renders in a collapsible block above each response.
- `max_tokens: 64000` — safe because the request streams.
- Aborting the browser request (the Stop button, or navigating away) propagates
  an `AbortSignal` into the SDK call, so a cancelled response stops being billed
  rather than running to completion unwatched.
- SDK errors are caught by typed class (`AuthenticationError`, `RateLimitError`,
  `APIError`) and sent as a terminal `error` event, never as a raw stack trace.

## Web search

Claude can search the internet mid-answer via the server-side `web_search_20260209`
tool. The toggle under the composer turns it on (default) or off per message;
when on, Claude decides for itself whether a question needs a search.

Search runs on Anthropic's infrastructure — there is no client-side tool loop and
no separate search API key. The server streams three extra event kinds to the UI:
the query Claude ran, the results it got back, and the citations attached to the
answer text. Searches appear as collapsible rows above the response; cited pages
are deduplicated into a Sources list beneath it.

Two failure modes are handled explicitly, because both are silent otherwise:

- **`pause_turn`.** The server-side tool loop stops after its iteration limit and
  returns `stop_reason: "pause_turn"` — not an error. The turn is resumed by
  echoing the assistant message back (up to `MAX_CONTINUATIONS`); without that the
  answer is truncated with no warning. If the cap is reached the UI says so
  rather than presenting a partial answer as complete.
- **Search errors.** These arrive as HTTP 200 with an error object in place of the
  result array (`max_uses_exceeded`, `too_many_requests`, …), so they are detected
  by branching on the result shape, not by catching an exception.

`MAX_SEARCHES` caps searches per message at 8.

## The background panel

A floating panel, bottom right, that offers reading on whatever the conversation
has drifted into — for the moment you are following an answer but not the term
it rests on.

Nothing polls, and no extra call is made on a turn where nobody needs it. The
chat model is already reading the conversation to answer it, so it is the
cheapest available judge of whether the person it is answering has lost the
thread. It gets one custom tool, `offer_background`, whose description carries
the whole policy: call it when the user asks what something means, says they are
new to it, or is about to be handed a technology they have not used — not for
terms they have already used correctly, and at most once per reply.

When Claude calls it, three things happen:

1. The tool result goes back immediately (`"Opened. …carry on with your answer"`),
   so the answer being streamed never stops to wait.
2. A `background` event opens the panel with the topic and one line on why it
   might help.
3. Two cheaper calls (Haiku 4.5, no thinking) run in parallel: one searches
   the web for reading and files the results through a forced `report_links`
   tool; the other restricts search to `youtube.com` and files through
   `report_videos`. `tool_choice: "any"` is what makes the output structured —
   each model can only reply by searching or by filing its report, never by
   writing prose someone has to parse. Haiku is the right tier for this: the
   task is small ("find URLs, describe each in a line"), so Opus's thinking
   would be paying for depth we don't need.

All gathers run alongside the answer rather than blocking it, so the panel
fills in while the reply is still being written. The `done` event is held back
until they settle, which keeps "the turn is finished" meaning the whole
exchange rather than just the prose. Watch and Read tabs are always present;
a Practice tab appears only when Claude opted in to one of two signals on
`offer_background`:

- `practice_queries: string[]` — the topic is one you learn by BUILDING
  (React hooks, Terraform, SQL joins). The tab gets mixed videos, articles,
  and interactive sandboxes.
- `include_quiz: true` — the topic is one you learn by RECALL (CAP theorem,
  time complexity classes, HTTP status codes). The tab gets a short MCQ quiz
  Claude wrote itself, with an explanation on every option — right or wrong —
  so a guess still teaches. The quiz runs inside the panel: one question at
  a time, click an option to reveal, Next to advance, final score at the end.

Both signals are independent; a topic can trigger neither, one, or both.
When both fire the quiz sits above the hands-on section under a "Check
yourself" header. The Watch tab defers loading the YouTube iframe until you
click a thumbnail, so opening the panel does not pull in five video players.

The panel rides on the web search toggle, since gathering its links means
searching: untick "Search the web" and Claude is not offered the tool at all.
Links are dropped unless they are `http(s)` URLs the search actually returned.
Topics accumulate for the session: the newest takes the panel, earlier ones stay
one click away, and the chevron collapses everything to a pill.

## Layout

```
server/index.ts        Express API: auth, session store, SSE chat proxy
server/turn.ts         One assistant turn: streaming, tool loop, event shapes
server/background.ts   Topic -> reading links, via search + a forced tool
src/lib/api.ts         Typed fetch wrappers + SSE parsing
src/components/        SignIn (key gate), Chat (transcript + composer),
                       BackgroundPanel (the bottom-right panel)
src/App.tsx            Auth gate — SignIn or Chat
```

## Known gaps

- Responses render as plain text; no markdown or syntax highlighting.
- No conversation persistence — a reload starts a fresh thread.
- No attachments, or retry-on-failed-turn.
- Web search is the only tool; there is no web *fetch*, so Claude sees search
  result snippets rather than full page contents.
- The background panel is per-session and in-memory: a reload loses the topics
  it has collected, and there is no way to ask for background on a topic Claude
  did not offer one for.
