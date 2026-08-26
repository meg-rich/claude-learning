import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db.ts";
import { GATHER_MODEL } from "./background.ts";
import type { QuizQuestion } from "./turn.ts";

/** How many questions each day's quiz contains. */
export const QUESTIONS_PER_DAY = 5;
/** Minimum topic pool size below which we won't build a quiz at all. */
export const MIN_POOL_FOR_QUIZ = 3;
/** Look-back window for a healthy pool. */
const PRIMARY_WINDOW_DAYS = 21;
/** Fallback window if the primary yields fewer than QUESTIONS_PER_DAY topics. */
const FALLBACK_WINDOW_DAYS = 60;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Row shape stored in learned_topics. */
export type LearnedTopicRow = {
  id: string;
  user_id: string;
  chat_id: string;
  topic: string;
  reason: string;
  created_at: number;
};

/** Row shape stored in daily_quizzes. */
export type DailyQuizRow = {
  user_id: string;
  quiz_date: string;
  questions_json: string;
  answers_json: string | null;
  score: number | null;
  generated_at: number;
  completed_at: number | null;
  dismissed_at: number | null;
};

export type DailyQuiz = {
  date: string;
  questions: QuizQuestion[];
  answers: number[] | null;
  score: number | null;
  generatedAt: number;
  completedAt: number | null;
  dismissedAt: number | null;
};

/** ISO date string (YYYY-MM-DD) in UTC — the "for" day of a quiz. */
export function utcDateString(millis: number = Date.now()): string {
  return new Date(millis).toISOString().slice(0, 10);
}

export function rowToDailyQuiz(row: DailyQuizRow): DailyQuiz {
  return {
    date: row.quiz_date,
    questions: JSON.parse(row.questions_json) as QuizQuestion[],
    answers: row.answers_json ? (JSON.parse(row.answers_json) as number[]) : null,
    score: row.score,
    generatedAt: row.generated_at,
    completedAt: row.completed_at,
    dismissedAt: row.dismissed_at,
  };
}

/* ---- prepared statements ---- */

const selectTopicsInWindow = db.prepare<[string, number]>(
  `SELECT id, user_id, chat_id, topic, reason, created_at
     FROM learned_topics
    WHERE user_id = ? AND created_at >= ?
    ORDER BY created_at DESC`,
);

const insertLearnedTopic = db.prepare(
  `INSERT OR IGNORE INTO learned_topics (id, user_id, chat_id, topic, reason, created_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
);

const getQuiz = db.prepare<[string, string]>(
  `SELECT * FROM daily_quizzes WHERE user_id = ? AND quiz_date = ?`,
);
const upsertQuiz = db.prepare(
  `INSERT INTO daily_quizzes
     (user_id, quiz_date, questions_json, answers_json, score, generated_at, completed_at, dismissed_at)
   VALUES (?, ?, ?, NULL, NULL, ?, NULL, NULL)
   ON CONFLICT(user_id, quiz_date) DO UPDATE SET
     questions_json = excluded.questions_json,
     answers_json   = NULL,
     score          = NULL,
     generated_at   = excluded.generated_at,
     completed_at   = NULL,
     dismissed_at   = NULL`,
);
const updateAnswers = db.prepare<[string, number, number, string, string]>(
  `UPDATE daily_quizzes
      SET answers_json = ?, score = ?, completed_at = ?
    WHERE user_id = ? AND quiz_date = ?`,
);
const updateDismissed = db.prepare<[number, string, string]>(
  `UPDATE daily_quizzes
      SET dismissed_at = ?
    WHERE user_id = ? AND quiz_date = ?`,
);
const listUsersWithRecentActivity = db.prepare<[number]>(
  `SELECT DISTINCT user_id FROM learned_topics WHERE created_at >= ?`,
);
const quizExists = db.prepare<[string, string]>(
  `SELECT 1 FROM daily_quizzes WHERE user_id = ? AND quiz_date = ?`,
);

/* ---- topic upsert (called from chats PATCH and boot backfill) ---- */

export type OfferBlob = {
  id?: unknown;
  topic?: unknown;
  reason?: unknown;
};

/**
 * Insert-if-new for every offer blob written on the chats PATCH path. The
 * id is already unique per background offer (Anthropic tool-use ids), so
 * INSERT OR IGNORE keeps this idempotent — a chat that's PATCHed 20 times as
 * new turns land only inserts each topic once. Timestamp is Date.now() at
 * first sighting; we don't have the exact offer moment on the payload, and
 * "when it landed in the DB" is close enough for a 21-day retention window.
 */
export function upsertOffersForChat(
  userId: string,
  chatId: string,
  offers: OfferBlob[],
  now: number = Date.now(),
): void {
  const insertMany = db.transaction((rows: OfferBlob[]) => {
    for (const offer of rows) {
      if (typeof offer.id !== "string" || typeof offer.topic !== "string") continue;
      const reason = typeof offer.reason === "string" ? offer.reason : "";
      insertLearnedTopic.run(offer.id, userId, chatId, offer.topic, reason, now);
    }
  });
  insertMany(offers);
}

/* ---- topic selection ---- */

/** Group by lowercased topic label so "SSE" and "sse" collapse before draw. */
function dedupeByTopic(rows: LearnedTopicRow[]): LearnedTopicRow[][] {
  const groups = new Map<string, LearnedTopicRow[]>();
  for (const row of rows) {
    const key = row.topic.trim().toLowerCase();
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  // Keep the newest instance per group as the representative — its reason
  // is likely the one the user last saw.
  return Array.from(groups.values()).map((bucket) =>
    bucket.sort((a, b) => b.created_at - a.created_at),
  );
}

/** Weighted sample without replacement. Older topics carry more weight so
 *  the quiz leans toward genuine retention rather than immediate recall. */
function weightedSample(groups: LearnedTopicRow[][], n: number, now: number): LearnedTopicRow[] {
  const pool = groups.map((group) => {
    const rep = group[0]!;
    const ageDays = Math.max(1, (now - rep.created_at) / MS_PER_DAY);
    // Cap so a three-week-old topic doesn't drown out anything newer.
    return { rep, weight: Math.min(ageDays, 21) };
  });
  const picked: LearnedTopicRow[] = [];
  while (picked.length < n && pool.length > 0) {
    const total = pool.reduce((sum, item) => sum + item.weight, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      r -= pool[idx]!.weight;
      if (r <= 0) break;
    }
    if (idx >= pool.length) idx = pool.length - 1;
    picked.push(pool[idx]!.rep);
    pool.splice(idx, 1);
  }
  return picked;
}

/** Returns up to QUESTIONS_PER_DAY diverse topics, extending the window when
 *  the recent pool is thin. Returns an empty array below MIN_POOL_FOR_QUIZ. */
export function selectTopicsForUser(
  userId: string,
  now: number = Date.now(),
): LearnedTopicRow[] {
  const primaryCutoff = now - PRIMARY_WINDOW_DAYS * MS_PER_DAY;
  let rows = selectTopicsInWindow.all(userId, primaryCutoff) as LearnedTopicRow[];
  if (dedupeByTopic(rows).length < QUESTIONS_PER_DAY) {
    const fallbackCutoff = now - FALLBACK_WINDOW_DAYS * MS_PER_DAY;
    rows = selectTopicsInWindow.all(userId, fallbackCutoff) as LearnedTopicRow[];
  }
  const groups = dedupeByTopic(rows);
  if (groups.length < MIN_POOL_FOR_QUIZ) return [];
  return weightedSample(groups, QUESTIONS_PER_DAY, now);
}

/* ---- generation ---- */

const DAILY_QUIZ_TOOL: Anthropic.Tool = {
  name: "report_daily_quiz",
  description: "File the day's multiple-choice quiz. Call this exactly once.",
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
              description:
                "The question itself, plainly worded. Aim at the IDEA behind the topic, not verbatim phrasing.",
            },
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
                      "One short sentence explaining WHY this option is right or wrong. The reader sees it after they guess, so make it teach.",
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
 * Generates a multi-topic recall quiz on Haiku, one question per topic.
 * Structured through a forced `report_daily_quiz` tool — same pattern the
 * background quiz and course generation use. Returns [] on malformed output;
 * the caller decides whether to write a row or skip the user for the day.
 */
export async function generateDailyQuiz({
  apiKey,
  topics,
  signal,
}: {
  apiKey: string;
  topics: LearnedTopicRow[];
  signal: AbortSignal;
}): Promise<QuizQuestion[]> {
  if (topics.length === 0) return [];
  const client = new Anthropic({ apiKey });

  const bullets = topics
    .map((topic) => `- ${topic.topic}${topic.reason ? ` — ${topic.reason}` : ""}`)
    .join("\n");

  const response = await client.messages.create(
    {
      model: GATHER_MODEL,
      max_tokens: 4000,
      tools: [DAILY_QUIZ_TOOL],
      tool_choice: { type: "tool", name: DAILY_QUIZ_TOOL.name },
      messages: [
        {
          role: "user",
          content: `The learner has recently been exposed to these concepts across chats:

${bullets}

Write exactly ${topics.length} multiple-choice questions — one per concept, in the order given.
Each question checks whether the learner understood the IDEA behind the concept, not whether
they remember the exact wording. Aim for questions that would still make sense a week from now.

Each question has exactly 4 options: one correct, three plausible-but-wrong distractors that
reflect real misconceptions someone new to the topic might have. Do not repeat the same idea
across questions. For every option — right or wrong — write one short sentence explaining WHY.
The learner sees the explanation after they pick, so make it teach.`,
        },
      ],
    },
    { signal },
  );

  const filed = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === DAILY_QUIZ_TOOL.name,
  );
  if (!filed) return [];
  const { questions } = filed.input as { questions?: QuizQuestion[] };
  return (questions ?? []).filter(
    (question) =>
      typeof question.prompt === "string" &&
      Array.isArray(question.options) &&
      question.options.length >= 2 &&
      question.options.filter((option) => option.correct).length === 1,
  );
}

/* ---- pipeline: select → generate → write ---- */

// Coalesce concurrent regenerations for the same user — a second click while
// the first is in flight returns the same promise instead of double-billing.
const inFlight = new Map<string, Promise<DailyQuiz | null>>();

export type GenerateResult =
  | { ok: true; quiz: DailyQuiz }
  | { ok: false; reason: "insufficient-pool" }
  | { ok: false; reason: "generation-failed"; message: string };

export async function generateAndStoreQuizForUser({
  apiKey,
  userId,
  signal,
  now = Date.now(),
}: {
  apiKey: string;
  userId: string;
  signal: AbortSignal;
  now?: number;
}): Promise<GenerateResult> {
  const topics = selectTopicsForUser(userId, now);
  if (topics.length < MIN_POOL_FOR_QUIZ) return { ok: false, reason: "insufficient-pool" };

  try {
    const questions = await generateDailyQuiz({ apiKey, topics, signal });
    if (questions.length === 0)
      return { ok: false, reason: "generation-failed", message: "No questions produced." };
    const date = utcDateString(now);
    upsertQuiz.run(userId, date, JSON.stringify(questions), now);
    const row = getQuiz.get(userId, date) as DailyQuizRow;
    return { ok: true, quiz: rowToDailyQuiz(row) };
  } catch (error) {
    return {
      ok: false,
      reason: "generation-failed",
      message: error instanceof Error ? error.message : "Unknown error.",
    };
  }
}

/**
 * Coalesced wrapper used by both the cron and the /regenerate endpoint. If a
 * generation is already in flight for this user, the second caller awaits the
 * first rather than firing a parallel Haiku call.
 */
export function regenerateForUser({
  apiKey,
  userId,
  signal,
}: {
  apiKey: string;
  userId: string;
  signal: AbortSignal;
}): Promise<DailyQuiz | null> {
  const existing = inFlight.get(userId);
  if (existing) return existing;
  const promise = generateAndStoreQuizForUser({ apiKey, userId, signal })
    .then((result) => (result.ok ? result.quiz : null))
    .finally(() => {
      inFlight.delete(userId);
    });
  inFlight.set(userId, promise);
  return promise;
}

/** Public read of today's quiz for a user; null if none. */
export function getTodayQuiz(userId: string, now: number = Date.now()): DailyQuiz | null {
  const row = getQuiz.get(userId, utcDateString(now)) as DailyQuizRow | undefined;
  return row ? rowToDailyQuiz(row) : null;
}

/** Score the caller's picks against the stored questions, then persist. */
export function submitAnswers(
  userId: string,
  answers: number[],
  now: number = Date.now(),
): DailyQuiz | null {
  const date = utcDateString(now);
  const row = getQuiz.get(userId, date) as DailyQuizRow | undefined;
  if (!row) return null;
  const questions = JSON.parse(row.questions_json) as QuizQuestion[];
  const score = questions.reduce((acc, question, i) => {
    const picked = answers[i];
    if (picked === undefined) return acc;
    return acc + (question.options[picked]?.correct ? 1 : 0);
  }, 0);
  updateAnswers.run(JSON.stringify(answers), score, now, userId, date);
  const updated = getQuiz.get(userId, date) as DailyQuizRow;
  return rowToDailyQuiz(updated);
}

/** Mark today's quiz row dismissed; returns the updated row or null. */
export function dismissTodayQuiz(userId: string, now: number = Date.now()): DailyQuiz | null {
  const date = utcDateString(now);
  const row = getQuiz.get(userId, date) as DailyQuizRow | undefined;
  if (!row) return null;
  updateDismissed.run(now, userId, date);
  const updated = getQuiz.get(userId, date) as DailyQuizRow;
  return rowToDailyQuiz(updated);
}

/** Users with any topic activity in the last FALLBACK_WINDOW_DAYS days. */
export function usersEligibleForCron(now: number = Date.now()): string[] {
  const cutoff = now - FALLBACK_WINDOW_DAYS * MS_PER_DAY;
  const rows = listUsersWithRecentActivity.all(cutoff) as { user_id: string }[];
  return rows.map((row) => row.user_id);
}

/** Cheap check used by the cron backfill to skip users who already have today. */
export function hasQuizForToday(userId: string, now: number = Date.now()): boolean {
  return quizExists.get(userId, utcDateString(now)) !== undefined;
}
