import express from "express";
import { requireUser, type User } from "./auth.ts";
import {
  dismissTodayQuiz,
  getTodayQuiz,
  regenerateForUser,
  selectTopicsForUser,
  submitAnswers,
  MIN_POOL_FOR_QUIZ,
} from "./dailyQuiz.ts";
import { describeError } from "./turn.ts";

export function makeDailyQuizRouter(getApiKey: () => string | null) {
  const router = express.Router();
  router.use(requireUser);

  // Today's quiz, or null if the user has none for today.
  router.get("/", (_req, res) => {
    const user = res.locals.user as User;
    const quiz = getTodayQuiz(user.id);
    res.json({ quiz });
  });

  // Score the caller's picks and persist. 404 when today's row doesn't exist.
  router.post("/answers", (req, res) => {
    const user = res.locals.user as User;
    const body = req.body as { answers?: unknown };
    if (
      !Array.isArray(body.answers) ||
      body.answers.some((value) => typeof value !== "number" || !Number.isInteger(value))
    ) {
      res.status(400).json({ error: "answers must be an array of integers." });
      return;
    }
    const quiz = submitAnswers(user.id, body.answers as number[]);
    if (!quiz) {
      res.status(404).json({ error: "No quiz for today." });
      return;
    }
    res.json({ quiz });
  });

  // Rebuild today's quiz for the caller. Requires a server-side API key.
  router.post("/regenerate", async (_req, res) => {
    const user = res.locals.user as User;
    const apiKey = getApiKey();
    if (!apiKey) {
      res.status(503).json({ error: "This deployment has no Anthropic API key configured." });
      return;
    }
    const pool = selectTopicsForUser(user.id);
    if (pool.length < MIN_POOL_FOR_QUIZ) {
      res.status(424).json({
        error: `Not enough recent activity — need at least ${MIN_POOL_FOR_QUIZ} distinct topics from the last few weeks.`,
      });
      return;
    }
    try {
      const quiz = await regenerateForUser({
        apiKey,
        userId: user.id,
        signal: AbortSignal.timeout(60_000),
      });
      if (!quiz) {
        res.status(502).json({ error: "Quiz generation returned nothing." });
        return;
      }
      res.json({ quiz });
    } catch (error) {
      res.status(502).json({ error: describeError(error) });
    }
  });

  // Hide today's quiz until tomorrow (or until the user regenerates).
  router.post("/dismiss", (_req, res) => {
    const user = res.locals.user as User;
    const quiz = dismissTodayQuiz(user.id);
    if (!quiz) {
      res.status(404).json({ error: "No quiz for today." });
      return;
    }
    res.json({ quiz });
  });

  return router;
}
