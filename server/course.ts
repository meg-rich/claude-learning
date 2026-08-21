import Anthropic from "@anthropic-ai/sdk";
import {
  GATHER_MODEL,
  gatherLinks,
  gatherVideos,
} from "./background.ts";
import type { LearnLink, LearnVideo } from "./turn.ts";

export type CourseModule = {
  name: string;
  objective: string;
  concepts: string[];
  firstPrompt: string;
  /** Web reading list for the module — filled after the syllabus is drafted. */
  readings: LearnLink[];
  /** YouTube videos for the module — filled after the syllabus is drafted. */
  videos: LearnVideo[];
  /** Small illustrative thumbnail (Wikipedia) — null when nothing was found. */
  image: { url: string; alt: string } | null;
};

export type Course = {
  title: string;
  overview: string;
  modules: CourseModule[];
};

export type IntakeQuestion = {
  prompt: string;
  kind: "choice" | "text";
  /** For "choice"; ignored otherwise. */
  options: string[];
};

export type IntakeAnswer = { question: string; answer: string };

const COURSE_TOOL: Anthropic.Tool = {
  name: "report_course",
  description:
    "File the course. Call this exactly once, when you know the full syllabus.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: {
        type: "string",
        description: 'Course title, e.g. "Introduction to Statistical Inference".',
      },
      overview: {
        type: "string",
        description:
          "2-3 sentence summary of what the course covers and who it's for — plain, not marketing.",
      },
      modules: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", description: 'Short module name — e.g. "Sampling Distributions".' },
            objective: {
              type: "string",
              description:
                'One-sentence learning objective, phrased so the learner can check themselves — "By the end you can…".',
            },
            concepts: {
              type: "array",
              items: { type: "string" },
              description: "3-5 concrete concepts or techniques covered in this module.",
            },
            first_prompt: {
              type: "string",
              description:
                "The exact message the learner should send in a fresh chat to start this module — short, actionable, and framed to invite tutoring rather than a lecture.",
            },
          },
          required: ["name", "objective", "concepts", "first_prompt"],
        },
      },
    },
    required: ["title", "overview", "modules"],
  },
};

const INTAKE_TOOL: Anthropic.Tool = {
  name: "report_intake",
  description:
    "File the intake questions once you know which 3-4 would most sharpen the course for this specific topic.",
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
            prompt: {
              type: "string",
              description: "The question, phrased to the learner. Short.",
            },
            kind: {
              type: "string",
              enum: ["choice", "text"],
              description:
                '"choice" when you can enumerate the useful answers; "text" when the answer is genuinely open.',
            },
            options: {
              type: "array",
              items: { type: "string" },
              description:
                'For kind="choice", 3-5 concrete options ordered from lowest to highest depth/skill. Empty array for kind="text".',
            },
          },
          required: ["prompt", "kind", "options"],
        },
      },
    },
    required: ["questions"],
  },
};

/**
 * Generates 3-4 topic-tailored intake questions. Runs before the course itself
 * so the syllabus is fit to the learner's starting point, goal, and rhythm.
 */
export async function generateIntake({
  apiKey,
  topic,
  signal,
}: {
  apiKey: string;
  topic: string;
  signal: AbortSignal;
}): Promise<IntakeQuestion[]> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create(
    {
      model: GATHER_MODEL,
      max_tokens: 1500,
      tools: [INTAKE_TOOL],
      tool_choice: { type: "tool", name: INTAKE_TOOL.name },
      messages: [
        {
          role: "user",
          content: `A learner wants a course on: ${topic}

Ask the 3-4 questions that would most sharpen the course for THIS specific topic. Skip generic
questions ("what's your goal?") unless the answer would meaningfully change the syllabus. Ask
about the things that matter for THIS topic — for programming that's usually current languages
and target project; for music, instrument and style; for languages, starting level and use
case; for stats, math background and application domain. Prefer "choice" questions with real
enumerable answers over open text. Order questions from most-impactful first.`,
        },
      ],
    },
    { signal },
  );

  const filed = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === INTAKE_TOOL.name,
  );
  if (!filed) return [];
  const { questions } = filed.input as { questions?: IntakeQuestion[] };
  return (questions ?? []).slice(0, 4);
}

/**
 * Generates a short structured syllabus for the topic. Runs on Haiku — the
 * shape is small, and Opus's thinking would be paying for depth we don't need.
 */
export async function generateCourse({
  apiKey,
  topic,
  intake,
  signal,
}: {
  apiKey: string;
  topic: string;
  intake?: IntakeAnswer[];
  signal: AbortSignal;
}): Promise<Course | null> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create(
    {
      model: GATHER_MODEL,
      max_tokens: 4000,
      tools: [COURSE_TOOL],
      tool_choice: { type: "tool", name: COURSE_TOOL.name },
      messages: [
        {
          role: "user",
          content: `Design a short structured course on: ${topic}
${
  intake && intake.length > 0
    ? `\nWhat the learner told you about themselves:\n${intake
        .map((row) => `  · ${row.question} — ${row.answer}`)
        .join("\n")}\n\nTailor the syllabus to those answers.`
    : ""
}
Aim for 4-6 modules that build on each other, gentlest first. For each module:
- a short name
- one-sentence learning objective, phrased "By the end you can…"
- 3-5 concrete concepts
- a "first prompt" the learner can paste into a fresh tutoring chat to start that module

Write the top-level overview in 2-3 sentences — plain, not marketing. The learner will follow
this as a curriculum, working through one module per chat session with a tutor, so each
first_prompt needs to stand alone.`,
        },
      ],
    },
    { signal },
  );

  const filed = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === COURSE_TOOL.name,
  );
  if (!filed) return null;
  const raw = filed.input as {
    title?: string;
    overview?: string;
    modules?: { name: string; objective: string; concepts: string[]; first_prompt: string }[];
  };
  if (!raw.title || !Array.isArray(raw.modules) || raw.modules.length === 0) return null;
  return {
    title: raw.title,
    overview: raw.overview ?? "",
    modules: raw.modules.map((module) => ({
      name: module.name,
      objective: module.objective,
      concepts: Array.isArray(module.concepts) ? module.concepts : [],
      firstPrompt: module.first_prompt,
      readings: [],
      videos: [],
      image: null,
    })),
  };
}

/**
 * Small illustrative image per module, pulled from Wikipedia. No API key, no
 * cost, and images come with reasonable licensing.
 *
 * Uses the MediaWiki search API rather than the REST summary endpoint — the
 * summary endpoint returns 200 for disambiguation pages that carry no
 * thumbnail (e.g. "Glaze" is a disambiguation, "Ceramic glaze" is the real
 * article). Search finds the best-matching real article and returns its
 * thumbnail in one call. We take the first result that actually has one; if
 * the top few are all imageless, we move on to the next candidate query.
 */
async function fetchWikipediaThumbnail(
  candidates: string[],
  signal: AbortSignal,
): Promise<{ url: string; alt: string } | null> {
  for (const raw of candidates) {
    const query = raw.trim();
    if (!query) continue;
    const url = new URL("https://en.wikipedia.org/w/api.php");
    url.searchParams.set("action", "query");
    url.searchParams.set("format", "json");
    url.searchParams.set("generator", "search");
    url.searchParams.set("gsrsearch", query);
    url.searchParams.set("gsrlimit", "3");
    url.searchParams.set("prop", "pageimages");
    url.searchParams.set("piprop", "thumbnail");
    url.searchParams.set("pithumbsize", "400");
    try {
      const response = await fetch(url, {
        signal,
        headers: {
          // Wikipedia asks that clients identify themselves.
          "User-Agent": "claude-background/1.0 (course-generation)",
          Accept: "application/json",
        },
      });
      if (!response.ok) continue;
      const data = (await response.json()) as {
        query?: {
          pages?: Record<string, {
            title?: string;
            index?: number;
            thumbnail?: { source?: string };
          }>;
        };
      };
      const pages = Object.values(data.query?.pages ?? {})
        // MediaWiki keys pages by pageid, not rank — sort by the `index` field
        // so we honour the search-result ordering.
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      for (const page of pages) {
        const src = page.thumbnail?.source;
        if (src) return { url: src, alt: page.title ?? query };
      }
    } catch {
      /* network hiccup — try the next candidate */
    }
  }
  return null;
}

/** Reduce a module name like "The Hypothalamus & Pituitary: Master Control" to
 *  a plainer Wikipedia-lookup guess ("Hypothalamus and pituitary"). */
function simplifyForLookup(name: string): string {
  return name
    .replace(/^(the|a|an)\s+/i, "")
    .split(/[:—–-]/)[0]!
    .replace(/&/g, "and")
    .trim();
}

/**
 * Enriches each module with a handful of web reads and YouTube videos, so the
 * course is useful without ever opening a tutoring chat. Reads and videos for
 * every module run in parallel — one Haiku gather each, same infra the
 * background panel uses. Failures are swallowed per-module so one bad module
 * doesn't blank the whole syllabus.
 */
export async function enrichCourseWithResources({
  apiKey,
  course,
  signal,
  onModuleDone,
}: {
  apiKey: string;
  course: Course;
  signal: AbortSignal;
  /** Fired once per module as its readings/videos/image finish, so the caller
   *  can stream progress to a live UI. Called with the enriched module and the
   *  index it originally sat at. */
  onModuleDone?: (module: CourseModule, index: number) => void;
}): Promise<Course> {
  const tasks = course.modules.map(async (module, index) => {
    const topic = `${course.title} — ${module.name}: ${module.objective}`;
    const queries = module.concepts.length > 0 ? module.concepts.slice(0, 3) : [module.name];
    const imageCandidates = [
      module.name,
      simplifyForLookup(module.name),
      ...module.concepts.slice(0, 2),
      course.title,
    ];
    const [readings, videos, image] = await Promise.all([
      gatherLinks({ apiKey, topic, queries, signal }).catch(() => []),
      gatherVideos({ apiKey, topic, queries, signal }).catch(() => []),
      fetchWikipediaThumbnail(imageCandidates, signal).catch(() => null),
    ]);
    const enriched = { ...module, readings, videos, image };
    onModuleDone?.(enriched, index);
    return enriched;
  });
  const enriched = await Promise.all(tasks);
  return { ...course, modules: enriched };
}

/** Escape any Markdown link-syntax characters that appear in a title string,
 *  so titles like "Foo [beta]" survive as text instead of breaking the link. */
function mdEscape(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+!|])/g, "\\$1");
}

/** Render the course into the chat transcript as the first assistant turn.
 *  Emits Markdown — the chat's ReactMarkdown pipeline turns it into headings,
 *  lists, and real anchors. */
export function renderCourseAsText(course: Course): string {
  const lines: string[] = [];
  lines.push(`# ${course.title}`);
  if (course.overview) {
    lines.push("");
    lines.push(course.overview);
  }
  lines.push("");
  lines.push(
    "_How to use this: start a fresh chat for each module and paste its first prompt._",
  );

  course.modules.forEach((module, i) => {
    lines.push("");
    lines.push(`## Module ${i + 1} · ${module.name}`);
    if (module.image) {
      lines.push("");
      lines.push(`![${mdEscape(module.image.alt)}](${module.image.url})`);
    }
    lines.push("");
    lines.push(`**Objective.** ${module.objective}`);
    if (module.concepts.length > 0) {
      lines.push("");
      lines.push(`**Concepts.** ${module.concepts.join(" · ")}`);
    }

    if (module.readings.length > 0) {
      lines.push("");
      lines.push("**Read**");
      lines.push("");
      module.readings.forEach((link) => {
        const label = `${mdEscape(link.title)} — _${mdEscape(link.site)}_`;
        const why = link.why ? ` — ${link.why}` : "";
        lines.push(`- [${label}](${link.url})${why}`);
      });
    }

    if (module.videos.length > 0) {
      lines.push("");
      lines.push("**Watch**");
      lines.push("");
      module.videos.forEach((video) => {
        const label = `${mdEscape(video.title)} — _${mdEscape(video.channel)}_`;
        const why = video.why ? ` — ${video.why}` : "";
        lines.push(`- [${label}](${video.url})${why}`);
      });
    }

    lines.push("");
    lines.push("**First prompt**");
    lines.push("");
    lines.push("```");
    lines.push(module.firstPrompt);
    lines.push("```");
  });

  return lines.join("\n");
}
