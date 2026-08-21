import { FormattedMessage, defineMessages, useIntl, type IntlShape } from "react-intl";
import { useAtomValue } from "jotai";
import { courseJobFamily, type CourseJob } from "../store/courseJobs";
import { sidebarEntriesAtom } from "../store/chats";

type Props = {
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onFocusJob: (chatId: string) => void;
  onCancelJob: (chatId: string) => void;
};

const msgs = defineMessages({
  preparing: { defaultMessage: "Preparing…" },
  awaiting: { defaultMessage: "Awaiting details" },
  error: { defaultMessage: "Error" },
  drafting: { defaultMessage: "Drafting syllabus…" },
  chatsAria: { defaultMessage: "Chats" },
  newChatTitle: { defaultMessage: "New chat" },
  coursesInProgressAria: { defaultMessage: "Courses in progress" },
  cancelCourseAria: { defaultMessage: "Cancel course: {topic}" },
  cancelCourseTitle: { defaultMessage: "Cancel course" },
  deleteChatAria: { defaultMessage: "Delete {title}" },
  deleteChatFallback: { defaultMessage: "chat" },
  deleteChatTitle: { defaultMessage: "Delete chat" },
  courseTitle: { defaultMessage: "Course: {topic}" },
  newChatFallback: { defaultMessage: "New chat" },
});

function jobStatus(intl: IntlShape, job: CourseJob): string {
  if (job.stage === "loading-intake") return intl.formatMessage(msgs.preparing);
  if (job.stage === "answering") return intl.formatMessage(msgs.awaiting);
  if (job.stage === "error") return intl.formatMessage(msgs.error);
  const total = job.progress.modules.length;
  if (total === 0) return intl.formatMessage(msgs.drafting);
  return intl.formatMessage(
    { defaultMessage: "{done} / {total}" },
    { done: job.progress.doneIndices.size, total },
  );
}

type JobChipProps = {
  chatId: string;
  activeId: string;
  onFocus: (chatId: string) => void;
  onCancel: (chatId: string) => void;
};

function JobChip({ chatId, activeId, onFocus, onCancel }: JobChipProps) {
  const intl = useIntl();
  const job = useAtomValue(courseJobFamily(chatId));
  if (!job) return null;
  const isActive = job.chatId === activeId;
  const isError = job.stage === "error";
  return (
    <li
      className={`sidebar-job ${isActive ? "active" : ""} ${isError ? "error" : ""}`}
    >
      <button
        type="button"
        className="sidebar-job-body"
        onClick={() => onFocus(job.chatId)}
        title={intl.formatMessage(msgs.courseTitle, { topic: job.topic })}
      >
        <span className="sidebar-job-eyebrow">
          {!isError && <span className="sidebar-job-spinner" aria-hidden="true" />}
          <FormattedMessage defaultMessage="Course" />
        </span>
        <span className="sidebar-job-topic">{job.topic}</span>
        <span className="sidebar-job-status">{jobStatus(intl, job)}</span>
      </button>
      <button
        type="button"
        className="sidebar-job-cancel"
        aria-label={intl.formatMessage(msgs.cancelCourseAria, { topic: job.topic })}
        onClick={(event) => {
          event.stopPropagation();
          onCancel(job.chatId);
        }}
        title={intl.formatMessage(msgs.cancelCourseTitle)}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </li>
  );
}

/**
 * Left rail with the chat list. New chat is a prominent top action; each row
 * is click-to-select with a hover-revealed delete. In-flight course jobs get
 * their own chip section above the list so long-running generation is always
 * one click away.
 */
export function Sidebar({
  activeId,
  onSelect,
  onNew,
  onDelete,
  onFocusJob,
  onCancelJob,
}: Props) {
  const intl = useIntl();
  const entries = useAtomValue(sidebarEntriesAtom);
  const chatEntries = entries.filter((e) => e.kind === "chat");
  const jobIds = entries.filter((e) => e.kind === "course-job").map((e) => e.id);

  return (
    <aside className="sidebar" aria-label={intl.formatMessage(msgs.chatsAria)}>
      <div className="sidebar-hd">
        <span className="sidebar-title">
          <FormattedMessage defaultMessage="Chats" />
        </span>
        <button
          type="button"
          className="sidebar-new"
          onClick={onNew}
          title={intl.formatMessage(msgs.newChatTitle)}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          <FormattedMessage defaultMessage="New" />
        </button>
      </div>

      {jobIds.length > 0 && (
        <ul
          className="sidebar-jobs"
          aria-label={intl.formatMessage(msgs.coursesInProgressAria)}
        >
          {jobIds.map((id) => (
            <JobChip
              key={id}
              chatId={id}
              activeId={activeId}
              onFocus={onFocusJob}
              onCancel={onCancelJob}
            />
          ))}
        </ul>
      )}

      <ul className="sidebar-list">
        {chatEntries.map((chat) => (
          <li key={chat.id} className={chat.id === activeId ? "active" : ""}>
            <button
              type="button"
              className="sidebar-item"
              onClick={() => onSelect(chat.id)}
              aria-current={chat.id === activeId ? "page" : undefined}
            >
              <span className="sidebar-item-title">
                {chat.title || intl.formatMessage(msgs.newChatFallback)}
              </span>
            </button>
            <button
              type="button"
              className="sidebar-delete"
              aria-label={intl.formatMessage(msgs.deleteChatAria, {
                title: chat.title || intl.formatMessage(msgs.deleteChatFallback),
              })}
              onClick={(event) => {
                event.stopPropagation();
                onDelete(chat.id);
              }}
              title={intl.formatMessage(msgs.deleteChatTitle)}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
