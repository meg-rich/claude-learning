import { existsSync } from "node:fs";
import cookieParser from "cookie-parser";
import express from "express";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import {
  COOKIE,
  authenticate,
  createUser,
  endSession,
  resolveSession,
  setSessionCookie,
  startSession,
} from "./auth.ts";
import { chatsRouter } from "./chats.ts";
import { db } from "./db.ts";
import { makeDailyQuizRouter } from "./dailyQuizRouter.ts";
import {
  backfillLearnedTopics,
  startDailyQuizScheduler,
} from "./dailyQuizScheduler.ts";
import {
  enrichCourseWithResources,
  generateCourse,
  generateIntake,
  renderCourseAsText,
  type IntakeAnswer,
} from "./course.ts";
import { gatherLinks, gatherPractice, gatherQuiz, gatherVideos } from "./background.ts";
import { describeError, streamTurn, type TurnEvent } from "./turn.ts";

// Optional local .env — absent in most setups, so a miss is not an error.
try {
  process.loadEnvFile();
} catch {
  /* no .env file */
}

// In dev the API and the Vite dev server are separate processes, so the API
// takes its own variable — an ambient PORT (set by many dev harnesses and PaaS
// platforms) would otherwise collide with Vite. In production one process
// serves both, so the platform's PORT is the right thing to honour.
const PORT = Number(
  process.env.API_PORT ??
    (process.env.NODE_ENV === "production" ? process.env.PORT : null) ??
    3001,
);

/** Chat calls billed to the server. Login is separate from this being present:
 *  users can sign in and see the app; only /api/chat requires the key. */
const envKey = process.env.ANTHROPIC_API_KEY?.trim() || null;

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
const MIN_PASSWORD = 8;

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use(cookieParser());

/* ---- auth ---- */

app.get("/api/auth/status", (req, res) => {
  const user = resolveSession(req.cookies?.[COOKIE]);
  res.json(user ? { authenticated: true, username: user.username } : { authenticated: false });
});

app.post("/api/auth/signup", (req, res) => {
  const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
  if (!username || !USERNAME_RE.test(username)) {
    res.status(400).json({
      error: "Username must be 3–32 chars, letters/numbers/underscore/dot/dash only.",
    });
    return;
  }
  if (!password || password.length < MIN_PASSWORD) {
    res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters.` });
    return;
  }

  try {
    const user = createUser(username, password);
    const session = startSession(user.id);
    setSessionCookie(res, session.id, session.expiresAt);
    res.status(201).json({ authenticated: true, username: user.username });
  } catch (error: unknown) {
    // SQLITE_CONSTRAINT — username uniqueness.
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
      res.status(409).json({ error: "That username is taken." });
      return;
    }
    throw error;
  }
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
  if (typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Username and password are required." });
    return;
  }
  const user = authenticate(username, password);
  if (!user) {
    // Deliberately vague — don't leak which of username or password is wrong.
    res.status(401).json({ error: "Wrong username or password." });
    return;
  }
  const session = startSession(user.id);
  setSessionCookie(res, session.id, session.expiresAt);
  res.json({ authenticated: true, username: user.username });
});

app.post("/api/auth/logout", (req, res) => {
  const sid = req.cookies?.[COOKIE];
  if (sid) endSession(sid);
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ authenticated: false });
});

/* ---- chats CRUD ---- */

app.use("/api/chats", chatsRouter);

/* ---- daily retention quiz ---- */

app.use("/api/daily-quiz", makeDailyQuizRouter(() => envKey));

/* ---- course generation ---- */

/** Preflight: 3-4 topic-tailored questions to sharpen the syllabus. */
app.post("/api/courses/intake", async (req, res) => {
  const user = resolveSession(req.cookies?.[COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  if (!envKey) {
    res.status(503).json({ error: "This deployment has no Anthropic API key configured." });
    return;
  }
  const topic = typeof req.body?.topic === "string" ? req.body.topic.trim() : "";
  if (!topic) {
    res.status(400).json({ error: "topic is required." });
    return;
  }
  try {
    const questions = await generateIntake({
      apiKey: envKey,
      topic,
      signal: AbortSignal.timeout(20_000),
    });
    res.json({ questions });
  } catch (error) {
    res.status(502).json({ error: describeError(error) });
  }
});

/** Generate the course itself, given the topic and any intake answers, and
 *  drop it into a new chat owned by the calling user. */
// Course generation streams progress back as NDJSON so the wizard can show
// what's happening under the hood: a "drafting" phase while Claude writes the
// syllabus, then the syllabus's module names, then a per-module tick as each
// module's readings/videos/image finish. The final line carries the seeded
// chat. Errors come back as a single {type:"error"} line; the HTTP status is
// always 200 once headers flush, so the client reads status from the stream.
app.post("/api/courses", async (req, res) => {
  const user = resolveSession(req.cookies?.[COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  if (!envKey) {
    res.status(503).json({ error: "This deployment has no Anthropic API key configured." });
    return;
  }
  const topic = typeof req.body?.topic === "string" ? req.body.topic.trim() : "";
  if (!topic) {
    res.status(400).json({ error: "topic is required." });
    return;
  }
  const intake = Array.isArray(req.body?.answers) ? (req.body.answers as IntakeAnswer[]) : undefined;

  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  const emit = (event: unknown) => {
    res.write(JSON.stringify(event) + "\n");
  };

  try {
    // One long-lived signal covers both the syllabus draft and the per-module
    // resource gathers — the enrichment step fans out ~2N parallel Haiku
    // searches and needs the extra headroom.
    const signal = AbortSignal.timeout(180_000);

    emit({ type: "phase", phase: "drafting" });
    const syllabus = await generateCourse({ apiKey: envKey, topic, intake, signal });
    if (!syllabus) {
      emit({ type: "error", message: "Course generation returned no syllabus." });
      res.end();
      return;
    }

    emit({
      type: "syllabus",
      title: syllabus.title,
      modules: syllabus.modules.map((module) => ({ name: module.name })),
    });
    emit({ type: "phase", phase: "enriching" });

    const course = await enrichCourseWithResources({
      apiKey: envKey,
      course: syllabus,
      signal,
      onModuleDone: (module, index) => {
        emit({ type: "module-done", index, name: module.name });
      },
    });

    // Seed a new chat for this user with the course as its first assistant turn.
    const chatId = randomUUID();
    const now = Date.now();
    const title = `Course · ${course.title}`;
    const turns = [
      {
        id: randomUUID(),
        role: "assistant",
        text: renderCourseAsText(course),
        thinking: "",
        searches: [],
        citations: [],
      },
    ];
    db.prepare(
      "INSERT INTO chats (id, user_id, title, turns_json, offers_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(chatId, user.id, title, JSON.stringify(turns), "[]", now, now);

    emit({
      type: "chat",
      chat: { id: chatId, title, createdAt: now, updatedAt: now, turns, offers: [] },
    });
    res.end();
  } catch (error) {
    emit({ type: "error", message: describeError(error) });
    res.end();
  }
});

/* ---- streamed chat ---- */

app.post("/api/chat", async (req, res) => {
  const user = resolveSession(req.cookies?.[COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  if (!envKey) {
    res.status(503).json({
      error: "This deployment has no Anthropic API key configured. Set ANTHROPIC_API_KEY.",
    });
    return;
  }

  const messages = req.body?.messages as Anthropic.MessageParam[] | undefined;
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages must be a non-empty array." });
    return;
  }

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  // Let the browser cancel an in-flight response ("Stop" button / navigation).
  const controller = new AbortController();
  res.on("close", () => controller.abort());

  const send = (event: TurnEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const gathering: Promise<void>[] = [];
  let done: TurnEvent | null = null;

  try {
    await streamTurn({
      apiKey: envKey,
      messages,
      webSearch: req.body?.webSearch !== false,
      signal: controller.signal,
      emit: (event) => {
        if (event.type === "done") {
          done = event;
          return;
        }
        send(event);
        if (event.type !== "background") return;
        gathering.push(
          gatherLinks({
            apiKey: envKey,
            topic: event.topic,
            queries: event.queries,
            signal: controller.signal,
            onProgress: (activity) =>
              send({ type: "background_progress", id: event.id, kind: "read", activity }),
          })
            .then((links) => send({ type: "background_links", id: event.id, links }))
            .catch((error: unknown) => {
              if (controller.signal.aborted) return;
              send({
                type: "background_error",
                id: event.id,
                kind: "read",
                message: describeError(error),
              });
            }),
          gatherVideos({
            apiKey: envKey,
            topic: event.topic,
            queries: event.queries,
            signal: controller.signal,
            onProgress: (activity) =>
              send({ type: "background_progress", id: event.id, kind: "watch", activity }),
          })
            .then((videos) => send({ type: "background_videos", id: event.id, videos }))
            .catch((error: unknown) => {
              if (controller.signal.aborted) return;
              send({
                type: "background_error",
                id: event.id,
                kind: "watch",
                message: describeError(error),
              });
            }),
        );
        if (event.practiceQueries) {
          gathering.push(
            gatherPractice({
              apiKey: envKey,
              topic: event.topic,
              queries: event.practiceQueries,
              signal: controller.signal,
              onProgress: (activity) =>
                send({ type: "background_progress", id: event.id, kind: "practice", activity }),
            })
              .then((items) => send({ type: "background_practice", id: event.id, items }))
              .catch((error: unknown) => {
                if (controller.signal.aborted) return;
                send({
                  type: "background_error",
                  id: event.id,
                  kind: "practice",
                  message: describeError(error),
                });
              }),
          );
        }
        if (event.includeQuiz) {
          gathering.push(
            gatherQuiz({
              apiKey: envKey,
              topic: event.topic,
              signal: controller.signal,
              onProgress: (activity) =>
                send({ type: "background_progress", id: event.id, kind: "quiz", activity }),
            })
              .then((questions) => send({ type: "background_quiz", id: event.id, questions }))
              .catch((error: unknown) => {
                if (controller.signal.aborted) return;
                send({
                  type: "background_error",
                  id: event.id,
                  kind: "quiz",
                  message: describeError(error),
                });
              }),
          );
        }
      },
    });
    await Promise.allSettled(gathering);
    if (done) send(done);
  } catch (error) {
    if (controller.signal.aborted) {
      res.end();
      return;
    }
    send({ type: "error", message: describeError(error) });
  } finally {
    res.end();
  }
});

/* ---- static in prod ---- */

if (process.env.NODE_ENV === "production" && existsSync("dist")) {
  app.use(express.static("dist"));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile("index.html", { root: "dist" }));
}

app.listen(PORT, () => {
  console.log(`[claude-learning] API on http://localhost:${PORT}`);
  console.log(
    envKey
      ? "[claude-learning] ANTHROPIC_API_KEY set — /api/chat ready."
      : "[claude-learning] WARNING: no ANTHROPIC_API_KEY set; /api/chat will 503 until it is.",
  );

  // Backfill any offers that predate the learned_topics table so the first
  // day's cron has something to draw from. Cheap: INSERT OR IGNORE per row.
  const backfilled = backfillLearnedTopics();
  if (backfilled > 0) {
    console.log(`[daily-quiz] backfilled ${backfilled} offers into learned_topics.`);
  }

  // Scheduler only runs when there's a server-side key to bill against.
  // Users on per-session sign-in mode simply don't get the daily quiz.
  if (envKey) {
    startDailyQuizScheduler(envKey);
    console.log("[daily-quiz] scheduler armed — next pass at 04:00 UTC.");
  } else {
    console.log("[daily-quiz] disabled — no ANTHROPIC_API_KEY.");
  }
});
