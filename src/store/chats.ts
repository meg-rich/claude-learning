import { atom } from "jotai";
import { atomFamily } from "jotai/utils";
import type { LearnTopic } from "../components/LearnPanel";
import type { Turn } from "../components/Chat";
import { courseJobFamily, courseJobIdsAtom } from "./courseJobs";

export type ChatDoc = {
  id: string;
  title: string;
  turns: Turn[];
  offers: LearnTopic[];
  createdAt: number;
  updatedAt: number;
  hydrated: boolean;
};

const emptyDoc = (id: string): ChatDoc => ({
  id,
  title: "New chat",
  turns: [],
  offers: [],
  createdAt: 0,
  updatedAt: 0,
  hydrated: false,
});

export const chatFamily = atomFamily((id: string) => atom<ChatDoc>(emptyDoc(id)));

export const chatIdsAtom = atom<string[]>([]);

export type SidebarEntry = {
  id: string;
  title: string;
  createdAt: number;
  kind: "chat" | "course-job";
};

export const sidebarEntriesAtom = atom<SidebarEntry[]>((get) => {
  const chatIds = get(chatIdsAtom);
  const entries: SidebarEntry[] = chatIds.map((id) => {
    const doc = get(chatFamily(id));
    return {
      id,
      title: doc.title,
      createdAt: doc.createdAt,
      kind: "chat" as const,
    };
  });

  const jobIds = get(courseJobIdsAtom);
  const jobEntries: SidebarEntry[] = [];
  for (const id of jobIds) {
    const job = get(courseJobFamily(id));
    if (!job) continue;
    jobEntries.push({
      id,
      title: `Course · ${job.topic}`,
      createdAt: job.createdAt,
      kind: "course-job",
    });
  }

  return [...entries, ...jobEntries].sort((a, b) => b.createdAt - a.createdAt);
});
