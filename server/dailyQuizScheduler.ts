import { db } from "./db.ts";
import {
  generateAndStoreQuizForUser,
  hasQuizForToday,
  upsertOffersForChat,
  usersEligibleForCron,
  utcDateString,
  type OfferBlob,
} from "./dailyQuiz.ts";

/** Hour of the UTC day the cron fires. Users on the US west coast get their
 *  fresh quiz around 8pm the previous evening; that's fine — Anki days aren't
 *  tied to a wall clock either. */
const CRON_HOUR_UTC = 4;
/** Small delay between users so we don't burst Haiku with N parallel calls. */
const PER_USER_DELAY_MS = 500;

const listChatsForBackfill = db.prepare(
  `SELECT id, user_id, offers_json, updated_at FROM chats WHERE offers_json != '[]'`,
);

/**
 * One-time pass on server boot: any offers already sitting in chats.offers_json
 * that predate the learned_topics table get inserted so the first day's cron
 * has something to draw from. INSERT OR IGNORE keeps this safe to re-run.
 *
 * Timestamps: we use the chat's updated_at as a rough approximation of when
 * the offer landed. Not exact, but the ordering across a user's chats is
 * preserved, which is what the age-weighted sampler cares about.
 */
export function backfillLearnedTopics(): number {
  const rows = listChatsForBackfill.all() as {
    id: string;
    user_id: string;
    offers_json: string;
    updated_at: number;
  }[];
  let inserted = 0;
  for (const row of rows) {
    let offers: OfferBlob[] = [];
    try {
      offers = JSON.parse(row.offers_json) as OfferBlob[];
    } catch {
      continue;
    }
    if (!Array.isArray(offers) || offers.length === 0) continue;
    upsertOffersForChat(row.user_id, row.id, offers, row.updated_at);
    inserted += offers.length;
  }
  return inserted;
}

/**
 * Runs the select → generate → write pipeline for every eligible user whose
 * quiz for today isn't already stored. Sequential with a small delay between
 * users so we don't fire a burst of API calls. Aborts cleanly on signal.
 */
export async function runCronPass({
  apiKey,
  signal,
}: {
  apiKey: string;
  signal: AbortSignal;
}): Promise<{ generated: number; skipped: number; failed: number }> {
  const stats = { generated: 0, skipped: 0, failed: 0 };
  const userIds = usersEligibleForCron();
  for (const userId of userIds) {
    if (signal.aborted) break;
    if (hasQuizForToday(userId)) {
      stats.skipped += 1;
      continue;
    }
    const result = await generateAndStoreQuizForUser({ apiKey, userId, signal });
    if (result.ok) {
      stats.generated += 1;
    } else if (result.reason === "insufficient-pool") {
      stats.skipped += 1;
    } else {
      stats.failed += 1;
      console.warn(
        `[daily-quiz] generation failed for user ${userId}: ${result.message}`,
      );
    }
    if (signal.aborted) break;
    await new Promise((resolve) => setTimeout(resolve, PER_USER_DELAY_MS));
  }
  return stats;
}

/** Millis from now until the next 04:00 UTC boundary. */
function msUntilNextCron(now: number = Date.now()): number {
  const next = new Date(now);
  next.setUTCHours(CRON_HOUR_UTC, 0, 0, 0);
  if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now;
}

/**
 * Starts the in-process daily scheduler. Reschedules itself after each run
 * using the current wall clock, so a system that boots at 03:59 UTC won't
 * double-fire. Returns an abort function that cancels the pending timer and
 * any in-flight generation.
 */
export function startDailyQuizScheduler(apiKey: string): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    const delay = msUntilNextCron();
    timer = setTimeout(async () => {
      timer = null;
      try {
        const stats = await runCronPass({ apiKey, signal: controller.signal });
        console.log(
          `[daily-quiz] cron pass: ${stats.generated} generated, ${stats.skipped} skipped, ${stats.failed} failed`,
        );
      } catch (error) {
        console.warn("[daily-quiz] cron pass threw:", error);
      }
      if (!controller.signal.aborted) schedule();
    }, delay);
  };

  // Boot-time backfill: any user who missed today's cron (server restarted
  // after 04:00 UTC, or feature just shipped) gets caught up now.
  (async () => {
    try {
      const bootStats = await runCronPass({ apiKey, signal: controller.signal });
      if (bootStats.generated > 0 || bootStats.failed > 0) {
        console.log(
          `[daily-quiz] boot backfill (for ${utcDateString()}): ${bootStats.generated} generated, ${bootStats.skipped} skipped, ${bootStats.failed} failed`,
        );
      }
    } catch (error) {
      console.warn("[daily-quiz] boot backfill threw:", error);
    }
  })();

  schedule();
  return () => {
    controller.abort();
    if (timer) clearTimeout(timer);
  };
}
