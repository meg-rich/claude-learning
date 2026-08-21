import type Anthropic from "@anthropic-ai/sdk";

export type AuthStatus =
  | { authenticated: false }
  | { authenticated: true; username: string };

export type Source = { title: string; url: string };

/** One thing worth reading about a topic, gathered for the background panel. */
export type LearnLink = { title: string; url: string; site: string; why: string };

/** A YouTube video worth watching about a topic. */
export type LearnVideo = {
  videoId: string;
  title: string;
  url: string;
  channel: string;
  why: string;
};

/** A hands-on resource: videos, articles, interactive sandboxes, or full courses. */
export type LearnPractice = {
  kind: "video" | "article" | "sandbox" | "course";
  title: string;
  url: string;
  source: string;
  why: string;
  videoId?: string;
};

/** One MCQ option; `why` is shown after the user picks. */
export type QuizOption = { text: string; correct: boolean; why: string };
export type QuizQuestion = { prompt: string; options: QuizOption[] };

/** A streamed chunk from POST /api/chat. */
export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "search"; query: string }
  | { type: "search_results"; results: Source[] }
  | { type: "search_error"; code: string }
  | { type: "citation"; url: string; title: string }
  | {
      type: "background";
      id: string;
      topic: string;
      reason: string;
      queries: string[];
      practiceQueries: string[] | null;
      includeQuiz: boolean;
    }
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
      refusal?: string;
    }
  | { type: "error"; message: string };

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const res = await fetch("/api/auth/status");
  if (!res.ok) return { authenticated: false };
  return (await res.json()) as AuthStatus;
}

export async function login(username: string, password: string): Promise<AuthStatus> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(await readError(res, "Sign-in failed."));
  return (await res.json()) as AuthStatus;
}

export async function signup(username: string, password: string): Promise<AuthStatus> {
  const res = await fetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(await readError(res, "Sign-up failed."));
  return (await res.json()) as AuthStatus;
}

export async function signOut(): Promise<AuthStatus> {
  const res = await fetch("/api/auth/logout", { method: "POST" });
  return (await res.json()) as AuthStatus;
}

/* Chats CRUD — the server owns them now; the client is a cache. */

export type ChatSummary = { id: string; title: string; createdAt: number; updatedAt: number };
export type ChatRecord = ChatSummary & { turns: unknown[]; offers: unknown[] };

export async function listChats(): Promise<ChatSummary[]> {
  const res = await fetch("/api/chats");
  if (!res.ok) throw new Error(await readError(res, "Could not load chats."));
  return ((await res.json()) as { chats: ChatSummary[] }).chats;
}

export async function createChat(): Promise<ChatRecord> {
  const res = await fetch("/api/chats", { method: "POST" });
  if (!res.ok) throw new Error(await readError(res, "Could not create chat."));
  return ((await res.json()) as { chat: ChatRecord }).chat;
}

export async function fetchChat(id: string): Promise<ChatRecord> {
  const res = await fetch(`/api/chats/${id}`);
  if (!res.ok) throw new Error(await readError(res, "Could not load that chat."));
  return ((await res.json()) as { chat: ChatRecord }).chat;
}

export async function patchChat(
  id: string,
  patch: { title?: string; turns?: unknown[]; offers?: unknown[] },
): Promise<ChatRecord> {
  const res = await fetch(`/api/chats/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await readError(res, "Could not save chat."));
  return ((await res.json()) as { chat: ChatRecord }).chat;
}

export async function deleteChat(id: string): Promise<void> {
  const res = await fetch(`/api/chats/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await readError(res, "Could not delete chat."));
}

/* Daily retention quiz — pregenerated in the server, one per user per UTC day. */

export type DailyQuiz = {
  date: string;
  questions: QuizQuestion[];
  answers: number[] | null;
  score: number | null;
  completedAt: number | null;
  dismissedAt: number | null;
};

export async function fetchDailyQuiz(): Promise<DailyQuiz | null> {
  const res = await fetch("/api/daily-quiz");
  if (!res.ok) throw new Error(await readError(res, "Could not load today's quiz."));
  return ((await res.json()) as { quiz: DailyQuiz | null }).quiz;
}

export async function submitDailyQuizAnswers(answers: number[]): Promise<DailyQuiz> {
  const res = await fetch("/api/daily-quiz/answers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });
  if (!res.ok) throw new Error(await readError(res, "Could not record answers."));
  return ((await res.json()) as { quiz: DailyQuiz }).quiz;
}

export async function regenerateDailyQuiz(): Promise<DailyQuiz> {
  const res = await fetch("/api/daily-quiz/regenerate", { method: "POST" });
  if (!res.ok) throw new Error(await readError(res, "Could not regenerate quiz."));
  return ((await res.json()) as { quiz: DailyQuiz }).quiz;
}

export async function dismissDailyQuiz(): Promise<DailyQuiz> {
  const res = await fetch("/api/daily-quiz/dismiss", { method: "POST" });
  if (!res.ok) throw new Error(await readError(res, "Could not dismiss quiz."));
  return ((await res.json()) as { quiz: DailyQuiz }).quiz;
}

/* Course generation — a two-step flow: intake questions, then the course itself. */

export type IntakeQuestion = { prompt: string; kind: "choice" | "text"; options: string[] };
export type IntakeAnswer = { question: string; answer: string };

export async function fetchCourseIntake(
  topic: string,
  signal?: AbortSignal,
): Promise<IntakeQuestion[]> {
  const res = await fetch("/api/courses/intake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic }),
    signal,
  });
  if (!res.ok) throw new Error(await readError(res, "Could not prepare course intake."));
  return ((await res.json()) as { questions: IntakeQuestion[] }).questions;
}

/** One line of NDJSON emitted by POST /api/courses while a course is being built.
 *  `phase` frames what is happening; `syllabus` names the modules the moment
 *  they're drafted; `module-done` ticks a module off as its resources land; the
 *  stream ends with either `chat` (success) or `error`. */
export type CourseEvent =
  | { type: "phase"; phase: "drafting" | "enriching" }
  | { type: "syllabus"; title: string; modules: { name: string }[] }
  | { type: "module-done"; index: number; name: string }
  | { type: "chat"; chat: ChatRecord }
  | { type: "error"; message: string };

export async function* generateCourse(
  topic: string,
  answers?: IntakeAnswer[],
  signal?: AbortSignal,
): AsyncGenerator<CourseEvent> {
  const res = await fetch("/api/courses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, answers }),
    signal,
  });
  if (!res.ok || !res.body) {
    yield {
      type: "error",
      message: await readError(res, "Could not generate course."),
    };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    if (done) break;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as CourseEvent;
      newline = buffer.indexOf("\n");
    }
  }
  const tail = buffer.trim();
  if (tail) yield JSON.parse(tail) as CourseEvent;
}

/**
 * POSTs the conversation and yields each server-sent event as it arrives.
 * Pass a signal to let the caller stop generation mid-response.
 */
export async function* streamChat(
  messages: Anthropic.MessageParam[],
  webSearch: boolean,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, webSearch }),
    signal,
  });

  if (!res.ok || !res.body) {
    yield { type: "error", message: await readError(res, "The server refused the request.") };
    return;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;

    // SSE frames are separated by a blank line; keep any partial tail buffered.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const payload = frame
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("");
      if (payload) yield JSON.parse(payload) as ChatEvent;
    }
  }
}
