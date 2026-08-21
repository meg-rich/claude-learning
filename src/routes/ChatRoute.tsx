import { useParams, Navigate } from "react-router-dom";
import { FormattedMessage } from "react-intl";
import { useAtomValue } from "jotai";
import { Chat } from "../components/Chat";
import { CourseWizard } from "../components/CourseWizard";
import { useChat } from "../queries/useChat";
import { courseJobFamily } from "../store/courseJobs";
import { chatFamily } from "../store/chats";

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
            <FormattedMessage defaultMessage="Generating a course on" />
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
