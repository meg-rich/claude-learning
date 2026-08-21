import { randomUUID } from "node:crypto";
import express from "express";
import { requireUser, type User } from "./auth.ts";
import { db } from "./db.ts";

/** Row shape we hold in the DB. Turns/offers live as JSON blobs. */
type ChatRow = {
  id: string;
  user_id: string;
  title: string;
  turns_json: string;
  offers_json: string;
  created_at: number;
  updated_at: number;
};

const listChats = db.prepare<[string]>(
  "SELECT id, title, created_at, updated_at FROM chats WHERE user_id = ? ORDER BY updated_at DESC",
);
const getChat = db.prepare<[string, string]>(
  "SELECT * FROM chats WHERE id = ? AND user_id = ?",
);
const insertChat = db.prepare(
  "INSERT INTO chats (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
);
const updateChat = db.prepare<
  [string | null, string | null, string | null, number, string, string]
>(
  `UPDATE chats
     SET title       = COALESCE(?, title),
         turns_json  = COALESCE(?, turns_json),
         offers_json = COALESCE(?, offers_json),
         updated_at  = ?
   WHERE id = ? AND user_id = ?`,
);
const deleteChat = db.prepare<[string, string]>(
  "DELETE FROM chats WHERE id = ? AND user_id = ?",
);

function toSummary(row: Pick<ChatRow, "id" | "title" | "created_at" | "updated_at">) {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Full chat, decoded — the client wants JSON, not string blobs. */
function toRecord(row: ChatRow) {
  return {
    ...toSummary(row),
    turns: JSON.parse(row.turns_json) as unknown[],
    offers: JSON.parse(row.offers_json) as unknown[],
  };
}

export const chatsRouter = express.Router();
chatsRouter.use(requireUser);

chatsRouter.get("/", (_req, res) => {
  const user = res.locals.user as User;
  const rows = listChats.all(user.id) as Pick<
    ChatRow,
    "id" | "title" | "created_at" | "updated_at"
  >[];
  res.json({ chats: rows.map(toSummary) });
});

chatsRouter.post("/", (_req, res) => {
  const user = res.locals.user as User;
  const id = randomUUID();
  const now = Date.now();
  insertChat.run(id, user.id, "New chat", now, now);
  res.status(201).json({
    chat: { id, title: "New chat", createdAt: now, updatedAt: now, turns: [], offers: [] },
  });
});

chatsRouter.get("/:id", (req, res) => {
  const user = res.locals.user as User;
  const row = getChat.get(req.params.id, user.id) as ChatRow | undefined;
  if (!row) {
    res.status(404).json({ error: "No such chat." });
    return;
  }
  res.json({ chat: toRecord(row) });
});

// PATCH accepts any subset of { title, turns, offers } — undefined fields keep
// their stored value thanks to COALESCE in the update statement.
chatsRouter.patch("/:id", (req, res) => {
  const user = res.locals.user as User;
  const body = req.body as { title?: string; turns?: unknown[]; offers?: unknown[] };
  const title = typeof body.title === "string" ? body.title : null;
  const turnsJson = Array.isArray(body.turns) ? JSON.stringify(body.turns) : null;
  const offersJson = Array.isArray(body.offers) ? JSON.stringify(body.offers) : null;

  const result = updateChat.run(
    title,
    turnsJson,
    offersJson,
    Date.now(),
    req.params.id!,
    user.id,
  );
  if (result.changes === 0) {
    res.status(404).json({ error: "No such chat." });
    return;
  }
  const row = getChat.get(req.params.id, user.id) as ChatRow;
  res.json({ chat: toRecord(row) });
});

chatsRouter.delete("/:id", (req, res) => {
  const user = res.locals.user as User;
  const result = deleteChat.run(req.params.id!, user.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "No such chat." });
    return;
  }
  res.json({ ok: true });
});
