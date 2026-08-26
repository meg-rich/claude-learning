import { randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import express from "express";
import { db } from "./db.ts";

export const COOKIE = "cb_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** scrypt cost — tuned to sub-100ms on the sort of machine this runs on. */
const SCRYPT_COST = 16384; // N
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expected] = stored.split("$");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_COST,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  const expectedBuf = Buffer.from(expected, "hex");
  // timingSafeEqual rejects mismatched lengths — cheap check first.
  return actual.length === expectedBuf.length && timingSafeEqual(actual, expectedBuf);
}

export type User = { id: string; username: string };
export type Session = { id: string; user_id: string; expires_at: number };

const findUserByUsername = db.prepare<[string]>(
  "SELECT id, username, password_hash FROM users WHERE username = ? COLLATE NOCASE",
);
const findUserById = db.prepare<[string]>("SELECT id, username FROM users WHERE id = ?");

const insertSession = db.prepare(
  "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
);
const findSession = db.prepare<[string]>(
  "SELECT id, user_id, expires_at FROM sessions WHERE id = ?",
);
const deleteSession = db.prepare<[string]>("DELETE FROM sessions WHERE id = ?");
const deleteExpired = db.prepare<[number]>("DELETE FROM sessions WHERE expires_at < ?");

/** Best-effort cleanup on startup — expired rows serve no purpose. */
deleteExpired.run(Date.now());

export function authenticate(username: string, password: string): User | null {
  const row = findUserByUsername.get(username) as
    | { id: string; username: string; password_hash: string }
    | undefined;
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  return { id: row.id, username: row.username };
}

export function startSession(userId: string): { id: string; expiresAt: number } {
  const id = randomUUID();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  insertSession.run(id, userId, now, expiresAt);
  return { id, expiresAt };
}

export function endSession(sessionId: string) {
  deleteSession.run(sessionId);
}

/** Look up the user behind a session cookie, dropping the session if expired. */
export function resolveSession(sessionId: string | undefined): User | null {
  if (!sessionId) return null;
  const session = findSession.get(sessionId) as Session | undefined;
  if (!session) return null;
  if (session.expires_at < Date.now()) {
    deleteSession.run(sessionId);
    return null;
  }
  const user = findUserById.get(session.user_id) as User | undefined;
  return user ?? null;
}

/** Sends the session cookie with the right flags for prod and dev. */
export function setSessionCookie(res: express.Response, sessionId: string, expiresAt: number) {
  res.cookie(COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: new Date(expiresAt),
    path: "/",
  });
}

/**
 * Middleware — attaches `res.locals.user` when logged in, or 401s otherwise.
 * Use on every route that touches a user's data.
 */
export function requireUser(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const user = resolveSession(req.cookies?.[COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  res.locals.user = user;
  next();
}
