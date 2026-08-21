import Anthropic from "@anthropic-ai/sdk";
import {
  type LearnLink,
  type LearnPractice,
  type LearnVideo,
  type QuizQuestion,
} from "./turn.ts";

/**
 * The gather is a small, well-scoped task — search a couple of times, then list
 * the URLs — so it runs on Haiku rather than the chat's Opus. Cheaper, faster,
 * and Opus's thinking doesn't earn its cost here.
 */
export const GATHER_MODEL = "claude-haiku-4-5";
/** Enough searching to find good material, not enough to become its own research task. */
const MAX_SEARCHES = 2;
/** Search → report is two steps; one spare covers a pause_turn. */
const MAX_ROUNDS = 3;
const MAX_LINKS = 6;
const MAX_VIDEOS = 4;
const MAX_PRACTICE = 5;

/** Extract the 11-char video id from any YouTube URL shape we might see. */
function youtubeId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/watch\?[^#]*v=|youtube\.com\/embed\/|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/,
  );
  return match ? match[1]! : null;
}

/** The reporting half of a gather. Forcing a tool (`tool_choice: any`) is what
 *  makes the output structured: the model may only answer by searching or by
 *  filing this report, never by writing prose we would then have to parse. */
type Report<T> = {
  tool: Anthropic.Tool;
  prompt: (topic: string, queries: string[]) => string;
  /** Whittle the returned rows: drop anything malformed, cap the total. */
  finalise: (raw: unknown) => T[];
  /** Domains the search is allowed to touch — undefined means "anywhere". */
  allowedDomains?: string[];
};

const READ: Report<LearnLink> = {
  tool: {
    name: "report_links",
    description:
      "File the reading list, once you have searched and know the real URLs. Call this exactly once, last.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        links: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string", description: "The page's own title, not a description of it." },
              url: { type: "string", description: "The full URL, exactly as the search returned it." },
              site: { type: "string", description: 'Who published it — e.g. "MDN", "Cloudflare Blog".' },
              why: {
                type: "string",
                description:
                  "One short sentence for a confused reader: what this page will tell them. No marketing.",
              },
            },
            required: ["title", "url", "site", "why"],
          },
        },
      },
      required: ["links"],
    },
  },
  prompt: (topic, queries) => `Someone is in the middle of a technical conversation and has lost the thread on: ${topic}

Search the web, then file a reading list of the 3-5 best things for them to read to catch up.
${queries.length > 0 ? `Suggested starting queries: ${queries.map((q) => `"${q}"`).join(", ")}.\n` : ""}
Favour primary sources and clear explainers — official docs, specifications, a well-regarded
write-up — over listicles, SEO pages, or anything selling a product. Order them so the gentlest
introduction comes first. Only report URLs that came back from a search; never invent one.`,
  finalise: (raw) => {
    const { links } = (raw ?? {}) as { links?: LearnLink[] };
    return (links ?? [])
      .filter((link) => /^https?:\/\//.test(link.url))
      .slice(0, MAX_LINKS);
  },
};

const WATCH: Report<LearnVideo> = {
  tool: {
    name: "report_videos",
    description:
      "File the video list, once you have searched and know the real URLs. Call this exactly once, last.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        videos: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string", description: "The video's own title, not a description of it." },
              url: {
                type: "string",
                description:
                  "The full YouTube URL, exactly as the search returned it — must contain a video id.",
              },
              channel: { type: "string", description: 'Uploader — e.g. "Fireship", "3Blue1Brown".' },
              why: {
                type: "string",
                description:
                  "One short sentence for a confused reader: what this video shows them. No marketing.",
              },
            },
            required: ["title", "url", "channel", "why"],
          },
        },
      },
      required: ["videos"],
    },
  },
  prompt: (topic, queries) => `Someone is in the middle of a technical conversation and has lost the thread on: ${topic}

Search YouTube for 2-4 videos that would help them catch up.
${queries.length > 0 ? `Suggested starting queries: ${queries.map((q) => `"${q} youtube"`).join(", ")}.\n` : ""}
Favour clear, well-explained tutorials on established channels — Fireship, 3Blue1Brown, ByteByteGo,
NancyPi, CS Dojo, official developer channels — over drive-by uploads with no views. Order them so
the gentlest introduction comes first. Only report YouTube URLs that came back from a search;
never invent one.`,
  allowedDomains: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"],
  finalise: (raw) => {
    const { videos } = (raw ?? {}) as { videos?: (LearnVideo & { videoId?: string })[] };
    return (videos ?? [])
      .map((video) => {
        const id = youtubeId(video.url);
        return id ? { ...video, videoId: id, url: `https://www.youtube.com/watch?v=${id}` } : null;
      })
      .filter((video): video is LearnVideo => video !== null)
      .slice(0, MAX_VIDEOS);
  },
};

/**
 * Runs one report to completion — search a bit, file the report, done.
 *
 * Runs as its own cheap call rather than inside the chat turn, so the answer
 * the user is reading never waits on searches they did not ask for.
 */
async function gather<T>({
  apiKey,
  topic,
  queries,
  signal,
  onProgress,
  report,
}: {
  apiKey: string;
  topic: string;
  queries: string[];
  signal: AbortSignal;
  onProgress?: (activity: string) => void;
  report: Report<T>;
}): Promise<T[]> {
  const client = new Anthropic({ apiKey });
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: report.prompt(topic, queries) },
  ];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    // Streaming so we can hear search queries as they fire — the wait for one
    // of these calls can otherwise be 20 seconds of silence.
    const stream = client.messages.stream(
      {
        model: GATHER_MODEL,
        // The output is a handful of URLs plus one-line descriptions — a couple
        // thousand tokens covers even a padded report with room to spare.
        max_tokens: 2000,
        // Haiku with no thinking is the cheapest possible "search + list URLs":
        // omitting `thinking` (and effort, which Haiku doesn't support) is the fast path.
        tools: [
          {
            type: "web_search_20260209",
            name: "web_search",
            max_uses: MAX_SEARCHES,
            // Haiku doesn't support programmatic tool calling; the default
            // `allowed_callers` requires it, so name the direct caller explicitly.
            allowed_callers: ["direct"],
            ...(report.allowedDomains ? { allowed_domains: report.allowedDomains } : {}),
          },
          report.tool,
        ],
        tool_choice: { type: "any" },
        messages,
      },
      { signal },
    );

    const pendingQueries = new Map<number, string>();
    for await (const event of stream) {
      if (event.type === "content_block_start" && event.content_block.type === "server_tool_use") {
        if (event.content_block.name === "web_search") pendingQueries.set(event.index, "");
      } else if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (delta.type === "input_json_delta" && pendingQueries.has(event.index)) {
          pendingQueries.set(event.index, pendingQueries.get(event.index)! + delta.partial_json);
        }
      } else if (event.type === "content_block_stop" && pendingQueries.has(event.index)) {
        const raw = pendingQueries.get(event.index)!;
        pendingQueries.delete(event.index);
        try {
          const query = (JSON.parse(raw) as { query?: string }).query ?? "";
          if (query) onProgress?.(`Searching “${query}”`);
        } catch {
          /* partial JSON — no update */
        }
      }
    }
    const response = await stream.finalMessage();

    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }

    const filed = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === report.tool.name,
    );
    if (filed) return report.finalise(filed.input);

    // Some other tool call (a search it wants to run itself); acknowledge and loop.
    const calls = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (calls.length === 0) break;
    messages.push({ role: "assistant", content: response.content });
    messages.push({
      role: "user",
      content: calls.map(
        (call): Anthropic.ToolResultBlockParam => ({
          type: "tool_result",
          tool_use_id: call.id,
          content: `Noted. File the ${report.tool.name === "report_links" ? "reading" : "video"} list with ${report.tool.name} now.`,
        }),
      ),
    });
  }

  return [];
}

export const gatherLinks = (args: {
  apiKey: string;
  topic: string;
  queries: string[];
  signal: AbortSignal;
  onProgress?: (activity: string) => void;
}) => gather({ ...args, report: READ });

const PRACTICE: Report<LearnPractice> = {
  tool: {
    name: "report_practice",
    description:
      "File the hands-on list, once you have searched and know the real URLs. Call this exactly once, last.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: {
                type: "string",
                enum: ["video", "article", "sandbox", "course"],
                description:
                  '"video" for a single walkthrough on YouTube, "article" for a written tutorial, "sandbox" for an interactive playground (CodeSandbox, StackBlitz, Replit, MDN "Try it", a Kaggle notebook), "course" for a structured multi-lesson course (Coursera, edX, Udemy, freeCodeCamp, Khan Academy, MIT OCW, official learning paths, MasterClass).',
              },
              title: { type: "string", description: "The page's or video's own title." },
              url: { type: "string", description: "The full URL, exactly as the search returned it." },
              source: {
                type: "string",
                description:
                  'Publisher or channel — e.g. "MDN", "freeCodeCamp", "Fireship", "CodeSandbox".',
              },
              why: {
                type: "string",
                description:
                  "One short sentence: what this resource will get them practising or building.",
              },
            },
            required: ["kind", "title", "url", "source", "why"],
          },
        },
      },
      required: ["items"],
    },
  },
  prompt: (topic, queries) => `Someone is in the middle of a conversation on: ${topic}

They want hands-on practice. Search the web for 3-6 items — a mix of short-form tutorials,
walkthroughs, interactive playgrounds, and (when the topic warrants it) full structured
courses.
${queries.length > 0 ? `Suggested starting queries: ${queries.map((q) => `"${q}"`).join(", ")}.\n` : ""}
Favour material that gets them started fast — official quickstarts, "build X in Y minutes",
interactive tutorials with a live editor, well-explained YouTube walkthroughs. Include one or
two proper COURSES from reputable platforms (Coursera, edX, Udemy, freeCodeCamp, Khan Academy,
MIT OCW, official learning paths) when the topic is broad enough to reward a multi-lesson
sit-down. Order by increasing depth: quick tutorial → sandbox → course. Only report URLs that
came back from a search; never invent one.`,
  finalise: (raw) => {
    const { items } = (raw ?? {}) as { items?: LearnPractice[] };
    return (items ?? [])
      .filter((item) => /^https?:\/\//.test(item.url))
      .map((item) => {
        // YouTube-hosted videos can be embedded in the tile, same as the Watch tab.
        if (item.kind === "video") {
          const id = youtubeId(item.url);
          return id
            ? { ...item, videoId: id, url: `https://www.youtube.com/watch?v=${id}` }
            : item;
        }
        return item;
      })
      .slice(0, MAX_PRACTICE);
  },
};

export const gatherVideos = (args: {
  apiKey: string;
  topic: string;
  queries: string[];
  signal: AbortSignal;
  onProgress?: (activity: string) => void;
}) => gather({ ...args, report: WATCH });

export const gatherPractice = (args: {
  apiKey: string;
  topic: string;
  queries: string[];
  signal: AbortSignal;
  onProgress?: (activity: string) => void;
}) => gather({ ...args, report: PRACTICE });

const QUIZ_TOOL: Anthropic.Tool = {
  name: "report_quiz",
  description: "File the multiple-choice quiz. Call this exactly once.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            prompt: { type: "string", description: "The question itself, plainly worded." },
            options: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  text: { type: "string", description: "The answer choice." },
                  correct: { type: "boolean" },
                  why: {
                    type: "string",
                    description:
                      "One short sentence explaining WHY this option is right or wrong — the reader will see it after they guess.",
                  },
                },
                required: ["text", "correct", "why"],
              },
            },
          },
          required: ["prompt", "options"],
        },
      },
    },
    required: ["questions"],
  },
};

/**
 * Generates a short recall quiz on the topic. No web search — Claude writes
 * questions from what it already knows, which is faster and cheaper than
 * searching. Kept to 3-4 questions; more starts feeling like an exam.
 */
export async function gatherQuiz({
  apiKey,
  topic,
  signal,
  onProgress,
}: {
  apiKey: string;
  topic: string;
  signal: AbortSignal;
  onProgress?: (activity: string) => void;
}): Promise<QuizQuestion[]> {
  const client = new Anthropic({ apiKey });
  onProgress?.("Writing questions…");

  const response = await client.messages.create(
    {
      model: GATHER_MODEL,
      max_tokens: 2500,
      tools: [QUIZ_TOOL],
      // Forces a single, structured answer instead of prose.
      tool_choice: { type: "tool", name: QUIZ_TOOL.name },
      messages: [
        {
          role: "user",
          content: `Someone is learning about: ${topic}

Write a 3-question multiple-choice quiz to help them check their recall. Each question has
exactly 4 options — one correct, three plausible-but-wrong distractors that reflect real
misconceptions. Do not repeat the same question idea twice. Keep prompts and options short
enough to read at a glance. For every option — right or wrong — write one sentence saying
why, so the learner sees the reasoning after they guess.`,
        },
      ],
    },
    { signal },
  );

  const filed = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === QUIZ_TOOL.name,
  );
  if (!filed) return [];
  const { questions } = filed.input as { questions?: QuizQuestion[] };
  // Only keep well-formed questions: 2+ options and exactly one marked correct.
  return (questions ?? []).filter(
    (question) =>
      Array.isArray(question.options) &&
      question.options.length >= 2 &&
      question.options.filter((option) => option.correct).length === 1,
  );
}

