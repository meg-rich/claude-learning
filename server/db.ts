import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

/**
 * The single SQLite database backing everything the server persists:
 * users, sessions, and chats. One file, no daemon, cleanly migrateable.
 *
 * Path is overridable via CB_DATABASE for tests and alternate deployments.
 */
const DB_PATH = process.env.CB_DATABASE ?? "./data/claude-background.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
// WAL is faster for the read-heavy chat-list traffic and safe in single-writer.
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Migrations — additive only. Idempotent so a rebuild is a no-op.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             TEXT PRIMARY KEY,
    username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash  TEXT NOT NULL,
    created_at     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS chats (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    turns_json   TEXT NOT NULL DEFAULT '[]',
    offers_json  TEXT NOT NULL DEFAULT '[]',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chats_user_updated ON chats(user_id, updated_at DESC);

  -- Denormalized index over the background offers already sitting in chats.offers_json.
  -- Populated on the chats PATCH path and backfilled on server boot. Kept flat so
  -- the daily-quiz selector can filter by (user_id, created_at) without JSON parsing.
  CREATE TABLE IF NOT EXISTS learned_topics (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    topic       TEXT NOT NULL,
    reason      TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_learned_topics_user_created
    ON learned_topics(user_id, created_at DESC);

  -- One row per user per UTC day. questions_json is the pregenerated QuizQuestion[]
  -- payload rendered by the shared Quiz component; answers_json is the user's picked
  -- option indexes once they complete. dismissed_at is set when the user hides the
  -- panel for the day (regenerate clears it back to null).
  CREATE TABLE IF NOT EXISTS daily_quizzes (
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quiz_date      TEXT NOT NULL,
    questions_json TEXT NOT NULL,
    answers_json   TEXT,
    score          INTEGER,
    generated_at   INTEGER NOT NULL,
    completed_at   INTEGER,
    dismissed_at   INTEGER,
    PRIMARY KEY (user_id, quiz_date)
  );
`);
