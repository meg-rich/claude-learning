import { useEffect } from "react";
import { useParams, Navigate } from "react-router-dom";
import { FormattedMessage } from "react-intl";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue, useSetAtom } from "jotai";
import { Chat, type Turn } from "../components/Chat";
import { CourseWizard } from "../components/CourseWizard";
import type { LearnTopic } from "../components/LearnPanel";
import { fetchChat, type ChatRecord } from "../lib/api";
import { courseJobFamily } from "../store/courseJobs";
import { chatFamily } from "../store/chats";

function useChat(id: string | null) {
  const query = useQuery<ChatRecord>({
    queryKey: ["chat", id],
    queryFn: () => fetchChat(id!),
    enabled: id !== null,
  });
  const setDoc = useSetAtom(id ? chatFamily(id) : chatFamily("__noop"));

  useEffect(() => {
    if (!id || !query.data) return;
    setDoc((prev) => {
      if (prev.hydrated) return prev;
      return {
        id,
        title: query.data.title,
        turns: (query.data.turns as Turn[]) ?? [],
        offers: (query.data.offers as LearnTopic[]) ?? [],
        createdAt: query.data.createdAt,
        updatedAt: query.data.updatedAt,
        hydrated: true,
      };
    });
  }, [id, query.data, setDoc]);

  return query;
}

export function ChatRoute() {
  const { id } = useParams<{ id: string }>();
  const chatId = id ?? null;
  // Read the job atom FIRST so placeholder ids don't trigger a doomed GET.
  const job = useAtomValue(chatId ? courseJobFamily(chatId) : courseJobFamily("__noop"));
  const query = useChat(job ? null : chatId);
  const doc = useAtomValue(chatId ? chatFamily(chatId) : chatFamily("__noop"));

  if (!chatId) return <Navigate to="/" replace />;
  if (job) {
    return (
      <div className="course-tab">
        <div className="course-tab-header">
          <div className="course-tab-eyebrow">
            <FormattedMessage defaultMessage="Generating a module on" />
          </div>
          <h1 className="course-tab-title">{job.topic}</h1>
        </div>
        <CourseWizard chatId={chatId} />
      </div>
    );
  }
  if (query.isLoading && !doc.hydrated)
    return (
      <div className="centered muted">
        <FormattedMessage defaultMessage="Loading…" />
      </div>
    );
  if (query.isError && !doc.hydrated) return <Navigate to="/" replace />;
  return <Chat key={chatId} chatId={chatId} />;
}
