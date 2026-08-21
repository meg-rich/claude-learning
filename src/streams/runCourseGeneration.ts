import type { getDefaultStore } from "jotai";
import {
  fetchCourseIntake,
  generateCourse,
  type ChatRecord,
  type ChatSummary,
  type IntakeAnswer,
} from "../lib/api";
import {
  cancelJob,
  courseJobFamily,
  initJob,
  jobController,
  removeJob,
  updateJob,
} from "../store/courseJobs";
import { chatFamily, chatIdsAtom } from "../store/chats";
import { queryClient } from "../app/queryClient";
import { router } from "../app/router";
import type { Turn } from "../components/Chat";
import type { LearnTopic } from "../components/LearnPanel";

type Store = ReturnType<typeof getDefaultStore>;

export async function startCourseJob(
  store: Store,
  chatId: string,
  topic: string,
): Promise<void> {
  const controller = initJob(store, chatId, topic);
  try {
    const questions = await fetchCourseIntake(topic, controller.signal);
    if (controller.signal.aborted) return;
    if (questions.length === 0) {
      await runGeneration(store, chatId, topic, []);
      return;
    }
    updateJob(store, chatId, (job) => ({ ...job, questions, stage: "answering" }));
  } catch (cause) {
    if (controller.signal.aborted) return;
    updateJob(store, chatId, (job) => ({
      ...job,
      stage: "error",
      error: cause instanceof Error ? cause.message : "Could not prepare the course.",
    }));
  }
}

export function setAnswer(store: Store, chatId: string, index: number, value: string): void {
  updateJob(store, chatId, (job) => ({
    ...job,
    answers: { ...job.answers, [index]: value },
  }));
}

export async function submitJob(store: Store, chatId: string): Promise<void> {
  const job = store.get(courseJobFamily(chatId));
  if (!job) return;
  const pairs: IntakeAnswer[] = job.questions
    .map((q, i) => ({ question: q.prompt, answer: (job.answers[i] ?? "").trim() }))
    .filter((p) => p.answer.length > 0);
  await runGeneration(store, chatId, job.topic, pairs);
}

export function cancelCourseJob(store: Store, chatId: string): void {
  cancelJob(store, chatId);
}

async function runGeneration(
  store: Store,
  placeholderId: string,
  topic: string,
  pairs: IntakeAnswer[],
): Promise<void> {
  const controller = jobController(placeholderId);
  if (!controller) return;
  updateJob(store, placeholderId, (job) => ({
    ...job,
    stage: "generating",
    error: undefined,
    progress: { phase: "drafting", modules: [], doneIndices: new Set() },
  }));

  let realChat: ChatRecord | null = null;
  try {
    for await (const event of generateCourse(topic, pairs, controller.signal)) {
      if (controller.signal.aborted) return;
      if (event.type === "phase") {
        updateJob(store, placeholderId, (job) => ({
          ...job,
          progress: { ...job.progress, phase: event.phase },
        }));
      } else if (event.type === "syllabus") {
        updateJob(store, placeholderId, (job) => ({
          ...job,
          progress: { ...job.progress, modules: event.modules },
        }));
      } else if (event.type === "module-done") {
        updateJob(store, placeholderId, (job) => {
          const next = new Set(job.progress.doneIndices);
          next.add(event.index);
          return { ...job, progress: { ...job.progress, doneIndices: next } };
        });
      } else if (event.type === "chat") {
        realChat = event.chat;
      } else if (event.type === "error") {
        throw new Error(event.message);
      }
    }
    if (!realChat) throw new Error("Course generation ended without a result.");
    handoff(store, placeholderId, realChat);
  } catch (cause) {
    if (controller.signal.aborted) return;
    updateJob(store, placeholderId, (job) => ({
      ...job,
      stage: "error",
      error: cause instanceof Error ? cause.message : "Course generation failed.",
    }));
  }
}

function handoff(store: Store, placeholderId: string, chat: ChatRecord): void {
  // 1. Seed the real chat atom.
  store.set(chatFamily(chat.id), {
    id: chat.id,
    title: chat.title,
    turns: (chat.turns as Turn[]) ?? [],
    offers: (chat.offers as LearnTopic[]) ?? [],
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    hydrated: true,
  });

  // 2. Query caches so sidebar picks it up and switch-in has data.
  const summary: ChatSummary = {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
  };
  queryClient.setQueryData<ChatSummary[]>(["chats"], (prev) => {
    const base = (prev ?? []).filter((c) => c.id !== chat.id);
    return [summary, ...base].sort((a, b) => b.updatedAt - a.updatedAt);
  });
  queryClient.setQueryData(["chat", chat.id], chat);

  // 3. Swap ids in chatIdsAtom (drop placeholder, add real id).
  store.set(chatIdsAtom, (prev) => [
    chat.id,
    ...prev.filter((id) => id !== placeholderId && id !== chat.id),
  ]);

  // 4. Move the router off the placeholder id BEFORE we null the placeholder
  //    job atom, so ChatRoute never renders a "job is gone, chat GET is
  //    pending" state. If a loader is ever added to /chats/:id, navigate
  //    resolves after the URL update settles — awaiting it keeps the
  //    invariant load-bearing on code, not on React's auto-batching.
  const done = () => removeJob(store, placeholderId);
  if (window.location.pathname === `/chats/${placeholderId}`) {
    void router.navigate(`/chats/${chat.id}`, { replace: true }).then(done, done);
  } else {
    done();
  }
}
