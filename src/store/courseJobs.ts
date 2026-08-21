import { atom, type getDefaultStore } from "jotai";
import { atomFamily } from "jotai/utils";
import type { IntakeQuestion } from "../lib/api";

export type CourseProgress = {
  phase: "drafting" | "enriching";
  modules: { name: string }[];
  doneIndices: Set<number>;
};

export type CourseJob = {
  chatId: string;
  topic: string;
  stage: "loading-intake" | "answering" | "generating" | "error";
  questions: IntakeQuestion[];
  answers: Record<number, string>;
  progress: CourseProgress;
  createdAt: number;
  error?: string;
};

const emptyProgress = (): CourseProgress => ({
  phase: "drafting",
  modules: [],
  doneIndices: new Set(),
});

export const courseJobFamily = atomFamily((_id: string) => atom<CourseJob | null>(null));
export const courseJobIdsAtom = atom<string[]>([]);

type Store = ReturnType<typeof getDefaultStore>;

const controllers = new Map<string, AbortController>();

export function initJob(store: Store, chatId: string, topic: string): AbortController {
  const controller = new AbortController();
  controllers.set(chatId, controller);
  store.set(courseJobFamily(chatId), {
    chatId,
    topic,
    stage: "loading-intake",
    questions: [],
    answers: {},
    progress: emptyProgress(),
    createdAt: Date.now(),
  });
  store.set(courseJobIdsAtom, (prev) => [chatId, ...prev.filter((id) => id !== chatId)]);
  return controller;
}

export function removeJob(store: Store, chatId: string): void {
  store.set(courseJobFamily(chatId), null);
  store.set(courseJobIdsAtom, (prev) => prev.filter((id) => id !== chatId));
  courseJobFamily.remove(chatId);
  controllers.delete(chatId);
}

export function cancelJob(store: Store, chatId: string): void {
  controllers.get(chatId)?.abort();
  controllers.delete(chatId);
  removeJob(store, chatId);
}

export function updateJob(
  store: Store,
  chatId: string,
  update: (job: CourseJob) => CourseJob,
): void {
  const current = store.get(courseJobFamily(chatId));
  if (!current) return;
  store.set(courseJobFamily(chatId), update(current));
}

export function jobController(chatId: string): AbortController | undefined {
  return controllers.get(chatId);
}

/** Kick off a new course generation from anywhere. Mints the placeholder id,
 *  starts the stream, and navigates the browser to the placeholder route.
 *  The handoff (placeholder → real id) is handled inside runCourseGeneration. */
export async function beginCourse(store: Store, topic: string): Promise<void> {
  const placeholderId = crypto.randomUUID();
  // Lazy imports avoid a top-level circular dep cycle
  // (courseJobs → runCourseGeneration → courseJobs, and
  //  courseJobs → app/router → routes/Root → runCourseGeneration → courseJobs).
  const [{ startCourseJob }, { router }] = await Promise.all([
    import("../streams/runCourseGeneration"),
    import("../app/router"),
  ]);
  void startCourseJob(store, placeholderId, topic);
  void router.navigate(`/chats/${placeholderId}`);
}
