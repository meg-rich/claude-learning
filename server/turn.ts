import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5";
/** Ceiling on web searches per message, and on turn continuations. */
export const MAX_SEARCHES = 8;
export const MAX_CONTINUATIONS = 5;

/** A single thing worth reading about the topic. */
export type LearnLink = { title: string; url: string; site: string; why: string };

/** A YouTube video worth watching about the topic. */
export type LearnVideo = {
  videoId: string;
  title: string;
  url: string;
  channel: string;
  why: string;
};

/** A hands-on practice resource: tutorial, walkthrough, sandbox, or full course. */
export type LearnPractice = {
  kind: "video" | "article" | "sandbox" | "course";
  title: string;
  url: string;
  source: string;
  why: string;
  /** Present when kind === "video" and the URL is a YouTube one — enables embed. */
  videoId?: string;
};

/** One choice on a quiz question; `why` explains it whether right or wrong. */
export type QuizOption = { text: string; correct: boolean; why: string };
/** One multiple-choice question generated for topics that are about recall. */
export type QuizQuestion = { prompt: string; options: QuizOption[] };

/** One frame of the UI event stream. */
export type TurnEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "search"; query: string }
  | { type: "search_results"; results: { title: string; url: string }[] }
  | { type: "search_error"; code: string }
  | { type: "citation"; url: string; title: string }
  /** Claude judged that the user is missing context, and named what on.
   *  `practiceQueries` is present only when the topic is one people learn by
   *  building — a hint that the panel should offer a Practice tab. */
  | {
      type: "background";
      id: string;
      topic: string;
      reason: string;
      queries: string[];
      practiceQueries: string[] | null;
      includeQuiz: boolean;
    }
  /** A short line on what a gather is doing right now. */
  | {
      type: "background_progress";
      id: string;
      kind: "read" | "watch" | "practice" | "quiz";
      activity: string;
    }
  | { type: "background_links"; id: string; links: LearnLink[] }
  | { type: "background_videos"; id: string; videos: LearnVideo[] }
  | { type: "background_practice"; id: string; items: LearnPractice[] }
  | { type: "background_quiz"; id: string; questions: QuizQuestion[] }
  | {
      type: "background_error";
      id: string;
      kind: "read" | "watch" | "practice" | "quiz";
      message: string;
    }
  | {
      type: "done";
      stop_reason: string | null;
      truncated?: boolean;
      usage: { input_tokens: number; output_tokens: number };
      refusal?: string | null;
    }
  | { type: "error"; message: string };

/**
 * The one tool the chat model has. Its description is the whole feature: the
 * model is already reading the conversation to answer, so it is the cheapest
 * possible judge of whether the person it is answering has lost the thread.
 */
const OFFER_BACKGROUND: Anthropic.Tool = {
  name: "offer_background",
  description:
    "Offer the user background reading on one concept — but be genuinely conservative. Most " +
    "questions do not need this; a plain, correct reply is almost always enough.\n\n" +
    "Call it when ANY of these paths applies:\n\n" +
    "  A. FOUNDATIONAL CONFUSION — the topic is a concept, mental model, or body of knowledge " +
    "     that takes more than a paragraph to understand well (not a one-sentence fact), AND " +
    "     the user is clearly lost on it. Signals: they say they're new/confused, they ask what " +
    "     something is or means, they misuse a term repeatedly, they describe normal behaviour " +
    "     as a bug, or the question they're asking only makes sense if they're missing the " +
    "     concept underneath.\n\n" +
    "  B. HIGH-STAKES DECISION — the user is about to make a CONSEQUENTIAL COMMITMENT " +
    '     ("signing the lease tomorrow", "putting in the offer", "starting the medication", ' +
    '     "buying the shares", "waiving the inspection", "accepting the settlement") on advice ' +
    "     from someone else, and they haven't shown they understand what they'd be agreeing to. " +
    "     Even if you can answer their immediate question, they deserve to know the shape of " +
    "     what they're committing to before they do it. High stakes = money, health, legal " +
    "     exposure, contracts, or anything hard to reverse.\n\n" +
    "  C. STUDY / REVIEW SESSION — the user names an exam, interview, class, or subject they're " +
    '     preparing on ("nursing student here, exam next week on X", "prepping for the bar", ' +
    '     "MCAT tomorrow", "job interview on data structures", "GRE verbal"). The panel is the ' +
    "     study aid — videos, reading, and (when the topic is recall-heavy) a quiz — exactly " +
    "     what a learner needs. This is NOT the coding-task exclusion below; a study/review " +
    "     request is a positive trigger. Set include_quiz true for recall-heavy subjects.\n\n" +
    "  D. NEW TO THE WHOLE DOMAIN — the user has flagged themselves as new to the entire area " +
    '     the question sits in, not just to one term ("I don\'t know much about X," "first time ' +
    '     dealing with X," "I\'m no expert on X," "never had to think about X before"). Even if ' +
    "     you can answer the specific question inline, they lack the framework to evaluate the " +
    "     next one — the primer is for the domain, not the question. This overrides the inline- " +
    "     correction exclusion below: a tidy checklist in your reply is not a reason to skip the " +
    "     panel here.\n\n" +
    "  E. VERDICT WITHOUT FRAMEWORK — the user is asking you to render a judgment " +
    '     ("do I need this?", "is this normal?", "is this a good deal?", "is this fair?", ' +
    '     "should I be worried?") in a domain where they have shown they cannot currently ' +
    "     render one themselves. Answering the immediate question gives them today's verdict; " +
    "     the primer gives them the criteria to render the next one on their own.\n\n" +
    "Do NOT call it when:\n" +
    "  · The correction is a single line you can just write inline (\"You want f/1.8, not f/16 — " +
    "    smaller number, bigger opening.\") — no panel needed. Note: this exclusion covers " +
    "    one-sentence corrections of a specific misconception, NOT multi-step checklists or " +
    "    frameworks written inline; if your reply is itself teaching a way to evaluate something, " +
    "    that is a signal the panel belongs (see paths D and E), not a reason to skip it.\n" +
    "  · The user is asking a PRODUCTION task (\"write this code\", \"debug this\", \"edit " +
    "    this draft\", \"draft this email\") and the answer is complete without background — " +
    "    panel gets in the way. This does NOT apply to study/review sessions (path C), where " +
    "    the panel is exactly the aid they want.\n" +
    "  · The topic is trivia, one-off facts, opinion, or personal (schedules, preferences).\n" +
    "  · The user is following along and using terms correctly.\n" +
    "  · You already offered background on this or a very close topic this session.\n\n" +
    "Rule of thumb: if you find yourself thinking \"they'd probably benefit from a proper primer " +
    "on X\" — call it. If \"one sentence in my reply handles this\" — don't. At most one call " +
    "per reply. Calling it does not change your reply: answer the actual question as normal, " +
    "including correcting any mistake inline, and do not mention the panel unless the user does.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      topic: {
        type: "string",
        description: 'The concept to gather reading on, as a short label — e.g. "Server-Sent Events".',
      },
      reason: {
        type: "string",
        description:
          "A short fragment — 8 words or fewer — naming the specific angle the reading covers. " +
          'Examples: "how storage choice affects XSS exposure", "contribution limits are ' +
          'per-type", "aperture number is inverse to opening size". No preamble ("This will ' +
          "help you…\", \"Your plan assumes…\"); no full sentences; the user is already in the " +
          "conversation and knows the context.",
      },
      queries: {
        type: "array",
        items: { type: "string" },
        description:
          "Two or three web search queries that would surface the clearest explanations of the topic.",
      },
      practice_queries: {
        type: ["array", "null"],
        items: { type: "string" },
        description:
          "Fill this ONLY when the topic is one people learn by BUILDING — a language, a " +
          "framework, a query dialect, a specific API someone types out. Two or three queries " +
          "aimed at hands-on tutorials, walkthroughs, or interactive playgrounds. Leave null " +
          "for definitions, categories, theorems, or anything you only ever read about.",
      },
      include_quiz: {
        type: "boolean",
        description:
          "Set true when the topic is one people learn by RECALL — definitions, distinctions " +
          '("what\'s the difference between X and Y"), classifications, theorems, historical ' +
          "facts, terminology someone has to hold in their head. The panel will generate a few " +
          "multiple-choice questions to help them check themselves. Leave false when the topic " +
          "is one you learn by doing, when practice_queries is already covering it, or when " +
          "there isn't a clean right/wrong answer to test.",
      },
    },
    required: ["topic", "reason", "queries", "practice_queries", "include_quiz"],
  },
};

/**
 * Streams one assistant turn, emitting UI events as they arrive.
 *
 * Two things can extend a turn past its first response, and both are handled
 * here: a server-tool loop that hits its iteration cap (`pause_turn`), and a
 * call to offer_background, which is acknowledged immediately so the answer
 * keeps writing while the caller fetches links in parallel.
 *
 * Throws on API failure; aborts surface as the signal being aborted.
 */
export async function streamTurn({
  apiKey,
  messages: incoming,
  webSearch,
  signal,
  emit,
}: {
  apiKey: string;
  messages: Anthropic.MessageParam[];
  webSearch: boolean;
  signal: AbortSignal;
  emit: (event: TurnEvent) => void;
}): Promise<void> {
  // Anthropic.Tool is the custom-tool variant only, so server tools need the
  // request's own tools type.
  // offer_background rides on the same toggle: gathering its links means
  // searching the web, and a user who turned search off did not ask for that.
  const tools: Anthropic.MessageCreateParams["tools"] = webSearch
    ? [
        { type: "web_search_20260209", name: "web_search", max_uses: MAX_SEARCHES },
        OFFER_BACKGROUND,
      ]
    : undefined;

  const client = new Anthropic({ apiKey });
  const messages = [...incoming];
  let last: Anthropic.Message | null = null;

  for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt++) {
    const stream = client.messages.stream(
      {
        model: MODEL,
        max_tokens: 64000,
        thinking: { type: "adaptive", display: "summarized" },
        // Opus 4.7 defaults to "high" effort, which is where the verbose replies
        // come from — "medium" keeps quality on hard questions while cutting the
        // preamble and reformulation on easy ones.
        output_config: { effort: "medium" },
        ...(tools ? { tools } : {}),
        messages,
      },
      { signal },
    );

    // A web_search query streams in as partial JSON, keyed by block index.
    const pendingQueries = new Map<number, string>();

    for await (const event of stream) {
      switch (event.type) {
        case "content_block_start": {
          const block = event.content_block;
          if (block.type === "server_tool_use" && block.name === "web_search") {
            pendingQueries.set(event.index, "");
          } else if (block.type === "web_search_tool_result") {
            // content is a result array on success and an error object on
            // failure — server tool errors arrive as HTTP 200, never thrown.
            if (Array.isArray(block.content)) {
              emit({
                type: "search_results",
                results: block.content.map((result) => ({
                  title: result.title,
                  url: result.url,
                })),
              });
            } else {
              emit({ type: "search_error", code: block.content.error_code });
            }
          }
          break;
        }

        case "content_block_delta": {
          const delta = event.delta;
          if (delta.type === "text_delta") emit({ type: "text", text: delta.text });
          else if (delta.type === "thinking_delta") emit({ type: "thinking", text: delta.thinking });
          else if (delta.type === "input_json_delta" && pendingQueries.has(event.index))
            pendingQueries.set(event.index, pendingQueries.get(event.index)! + delta.partial_json);
          else if (
            delta.type === "citations_delta" &&
            delta.citation.type === "web_search_result_location"
          )
            emit({
              type: "citation",
              url: delta.citation.url,
              title: delta.citation.title ?? delta.citation.url,
            });
          break;
        }

        case "content_block_stop": {
          const raw = pendingQueries.get(event.index);
          if (raw !== undefined) {
            pendingQueries.delete(event.index);
            let query = "";
            try {
              query = (JSON.parse(raw) as { query?: string }).query ?? "";
            } catch {
              /* incomplete partial JSON — announce the search without a query */
            }
            emit({ type: "search", query });
          }
          break;
        }
      }
    }

    last = await stream.finalMessage();

    // Server tools run in a server-side sampling loop. When that loop hits its
    // iteration limit the turn ends with stop_reason "pause_turn" and must be
    // resumed by sending the assistant turn back — without this the answer is
    // silently truncated, with no error. Echo the paused turn back verbatim;
    // do not append a "continue" message.
    if (last.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: last.content });
      continue;
    }

    if (last.stop_reason === "tool_use") {
      const calls = last.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );
      // Thinking blocks ride along unchanged — required when continuing a turn
      // on the same model.
      messages.push({ role: "assistant", content: last.content });
      messages.push({
        role: "user",
        content: calls.map(
          (call): Anthropic.ToolResultBlockParam => ({
            type: "tool_result",
            tool_use_id: call.id,
            content: "Opened. The user can see it; carry on with your answer.",
          }),
        ),
      });

      for (const call of calls) {
        if (call.name !== OFFER_BACKGROUND.name) continue;
        const input = call.input as {
          topic?: string;
          reason?: string;
          queries?: string[];
          practice_queries?: string[] | null;
          include_quiz?: boolean;
        };
        if (!input.topic) continue;
        emit({
          type: "background",
          id: call.id,
          topic: input.topic,
          reason: input.reason ?? "",
          queries: Array.isArray(input.queries) ? input.queries : [],
          practiceQueries:
            Array.isArray(input.practice_queries) && input.practice_queries.length > 0
              ? input.practice_queries
              : null,
          includeQuiz: input.include_quiz === true,
        });
      }
      continue;
    }

    break;
  }

  emit({
    type: "done",
    stop_reason: last?.stop_reason ?? null,
    truncated: last?.stop_reason === "pause_turn" || last?.stop_reason === "tool_use",
    usage: {
      input_tokens: last?.usage.input_tokens ?? 0,
      output_tokens: last?.usage.output_tokens ?? 0,
    },
    // stop_details is populated only on a refusal — guard before reading.
    ...(last?.stop_reason === "refusal" && last.stop_details
      ? { refusal: last.stop_details.explanation }
      : {}),
  });
}

/** Maps an SDK failure to a sentence safe to show a user — never a raw stack trace. */
export function describeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError)
    return "The API key was rejected. Sign in again.";
  if (error instanceof Anthropic.RateLimitError)
    return "Rate limited by the Anthropic API. Try again shortly.";
  if (error instanceof Anthropic.APIError) return `API error ${error.status}: ${error.message}`;
  return "Something went wrong talking to the Anthropic API.";
}
