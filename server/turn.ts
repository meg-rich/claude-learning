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
    "Offer the user background reading on one concept, so they can verify or act on your " +
    "answer with the context they need. The panel opens while you are still writing and " +
    "gives them something to actively engage with as your task completes — that engagement " +
    "is what lets them evaluate your output rather than accept it blindly.\n\n" +
    "TIMING — critical. If you are going to call this tool, call it BEFORE writing your " +
    "answer, not after. The panel's whole value is that it fills in while the user reads; " +
    "a call made late in a long reply arrives after the reader has already moved on. Decide " +
    "from the user's message itself, not from what you have drafted so far — the signals " +
    "below are visible in the question, so you can judge up front. When any case applies, " +
    "calling the tool is your FIRST action of the turn, before any prose.\n\n" +
    "Call it when ANY of these three cases applies — the user is CONFUSED or has a " +
    "MISCONCEPTION about something crucial to the task you are about to perform for them:\n\n" +
    "  1. NEW AREA AT WORK — the user is doing a work task that sits outside their usual " +
    "     lane. Could be a different field, an adjacent specialty within their field, or a " +
    "     role/responsibility that landed on them without prior experience. Examples: a " +
    "     first-time manager writing a performance review; a marketing manager writing a JD " +
    "     for an engineering role; a corporate lawyer drafting a housing lease; a founder " +
    "     handling their own HR; a junior employee producing a work artifact for the first " +
    "     time. They are competent adults — they just aren't in their usual territory. Do " +
    "     NOT skip this case because the user 'seems competent'; competence in their broader " +
    "     role is exactly the baseline that makes this specific unfamiliar sub-area worth a " +
    '     primer. Set topic to the specific sub-area they are new to ("performance review ' +
    '     calibration", "engineering role JDs"), not their whole profession.\n\n' +
    "  2. MISTAKEN ON A FOUNDATIONAL CONCEPT — the user's request is built on a wrong " +
    "     premise about the domain, and they have not asked to be corrected — they are " +
    "     confidently proceeding while asking for the task. Deliver the task anyway and " +
    "     correct the mistake inline, but ALSO fire the panel because the decision they " +
    "     will make with your output rests on a premise that needs shoring up. Signals: " +
    "     they present options as either/or when the options are not actually alternatives " +
    '     ("sell to an agent as a book OR do magazine excerpts", "Roth or 401(k)"); they ' +
    '     specify parameters that reveal a foundational gap ("I want a Roth — I make ' +
    '     $250k"); they ask you to produce something the domain does not work that way; ' +
    "     they use scare quotes around a term of art they are clearly not sure of; they mix " +
    "     vocabulary from adjacent-but-distinct domains as if interchangeable. Set topic to " +
    "     the specific concept they are mistaken about, not the whole domain.\n\n" +
    "  3. PERSONAL TASK, USER CLEARLY LACKS DOMAIN KNOWLEDGE — the user has asked for a " +
    "     personal (non-work) task in an area where they clearly do not have baseline " +
    "     knowledge. Examples: first international trip, first garden, first-time car " +
    "     buyer, new pet, inherited an estate, wedding planning, first home purchase, " +
    "     unfamiliar medical situation. They want the task done; they aren't asking to " +
    "     learn. But the background fills in alongside your work so they can evaluate " +
    "     whether your output actually fits their situation and make judgment calls about " +
    "     what to do with it. The signal is domain unfamiliarity revealed by the ask, not " +
    '     necessarily by an announcement ("first time", "I don\'t know much about") — an ' +
    "     ask that only makes sense from a beginner's position counts. Set topic to the " +
    "     specific area of the task, not the whole life category.\n\n" +
    "Do NOT call it when:\n" +
    "  · The correction is a single line you can just write inline (\"You want f/1.8, not " +
    "    f/16 — smaller number, bigger opening.\") — no panel needed. Note: this exclusion " +
    "    covers one-sentence corrections of a specific misconception, NOT multi-step " +
    "    checklists or frameworks written inline; if your reply is itself teaching a way to " +
    "    evaluate something, that is a signal the panel belongs, not a reason to skip it.\n" +
    "  · The user is a senior professional executing standard work in their own field with " +
    "    no foundational mistake — they know their job, and the panel would be noise.\n" +
    "  · The user is asking for a quick rewrite, summary, translation, lookup, or " +
    "    conversational task where there is no downstream decision to support.\n" +
    "  · The user is explicitly studying or reviewing for an exam or interview — this app " +
    "    is designed for people doing tasks, not people in study mode; that is a different " +
    "    use case.\n" +
    "  · The topic is trivia, one-off facts, opinion, or personal preferences (schedules, " +
    "    what movie to watch, etc.).\n" +
    "  · You already offered background on this or a very close topic this session.\n\n" +
    "Rule of thumb: if the user will have to evaluate, decide about, or act on your answer " +
    "AND one of the three cases above applies — fire it. If the task ends when you deliver " +
    "the output (a rewrite, a summary, a quick answer), or the user clearly knows their " +
    "territory — don't. At most one call per reply. Calling it does not change your reply: " +
    "answer the actual question as normal, including correcting any mistake inline, and do " +
    "not mention the panel unless the user does.",
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
