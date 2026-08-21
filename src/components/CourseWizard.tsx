import { useEffect, useState } from "react";
import {
  FormattedMessage,
  defineMessages,
  useIntl,
  type MessageDescriptor,
} from "react-intl";
import { useAtomValue, useStore } from "jotai";
import { courseJobFamily } from "../store/courseJobs";
import {
  cancelCourseJob,
  setAnswer,
  submitJob,
} from "../streams/runCourseGeneration";

type Props = {
  chatId: string;
};

/** Rotates while the course is generating — 5-word max, playful, on-theme.
 *  Same voice as Claude Code's status ticker: it should feel like the app is
 *  fond of the work it's doing. */
const generatingPhraseMessages: MessageDescriptor[] = Object.values(
  defineMessages({
    p01: { defaultMessage: "Chalking up the whiteboard…" },
    p02: { defaultMessage: "Assembling your syllabus…" },
    p03: { defaultMessage: "Rounding up the reading list…" },
    p04: { defaultMessage: "Sharpening the pencils…" },
    p05: { defaultMessage: "Sketching the lesson arcs…" },
    p06: { defaultMessage: "Consulting the textbook stack…" },
    p07: { defaultMessage: "Chasing footnotes down…" },
    p08: { defaultMessage: "Trimming the tangents…" },
    p09: { defaultMessage: "Alphabetizing the flashcards…" },
    p10: { defaultMessage: "Warming up the projector…" },
    p11: { defaultMessage: "Peer-reviewing the drafts…" },
    p12: { defaultMessage: "Fluffing the office hours…" },
  }),
);

const msgs = defineMessages({
  buildingCourseAria: { defaultMessage: "Building your course" },
  answerPlaceholder: { defaultMessage: "Your answer…" },
});

function StepIcon({ done }: { done: boolean }) {
  if (done) {
    return (
      <svg
        className="course-plan-icon done"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="5 12 10 17 19 7" />
      </svg>
    );
  }
  return <span className="course-plan-icon spinning" aria-hidden="true" />;
}

function ModuleStatus({ done }: { done: boolean }) {
  if (done) {
    return (
      <svg
        className="course-module-icon done"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="5 12 10 17 19 7" />
      </svg>
    );
  }
  return <span className="course-module-icon pending" aria-hidden="true" />;
}

function useRotatingPhrase(
  active: boolean,
  phrases: readonly MessageDescriptor[],
  intervalMs = 2200,
) {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * phrases.length));
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setIndex((current) => (current + 1) % phrases.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [active, phrases, intervalMs]);
  return phrases[index];
}

/**
 * Wizard view. All persistent state (stage, questions, answers, streaming
 * progress) lives in courseJobFamily so generation survives sidebar
 * navigation. This component is a projection of that job.
 */
export function CourseWizard({ chatId }: Props) {
  const intl = useIntl();
  const store = useStore();
  const job = useAtomValue(courseJobFamily(chatId));
  const generatingPhrase = useRotatingPhrase(
    job?.stage === "generating",
    generatingPhraseMessages,
  );

  if (!job) return null;

  const onAnswer = (index: number, value: string) => setAnswer(store, chatId, index, value);
  const onSubmit = () => void submitJob(store, chatId);
  const onCancel = () => cancelCourseJob(store, chatId);

  if (job.stage === "loading-intake") {
    return (
      <div className="course-wizard">
        <p className="bg-status muted small">
          <span className="bg-spinner" aria-hidden="true" />
          <FormattedMessage defaultMessage="Sizing up the topic…" />
        </p>
      </div>
    );
  }

  if (job.stage === "generating") {
    const total = job.progress.modules.length;
    const done = job.progress.doneIndices.size;
    const determinate = job.progress.phase === "enriching" && total > 0;
    const percent = determinate ? Math.round((done / total) * 100) : 0;
    return (
      <div className="course-wizard course-generating">
        <p className="course-progress-label muted small" aria-live="polite">
          {generatingPhrase ? intl.formatMessage(generatingPhrase) : null}
        </p>
        <div
          className={`course-progress ${determinate ? "determinate" : ""}`}
          role="progressbar"
          aria-label={intl.formatMessage(msgs.buildingCourseAria)}
          aria-valuemin={0}
          aria-valuemax={determinate ? total : undefined}
          aria-valuenow={determinate ? done : undefined}
        >
          <div
            className="course-progress-bar"
            style={determinate ? { width: `${percent}%` } : undefined}
          />
        </div>

        <ol className="course-plan" aria-live="polite">
          <li className={`course-plan-step ${total > 0 ? "done" : "active"}`}>
            <StepIcon done={total > 0} />
            <span>
              <FormattedMessage defaultMessage="Drafting the syllabus" />
            </span>
          </li>
          {total === 0 && job.progress.phase === "drafting" && (
            <li className="course-plan-hint muted small">
              <FormattedMessage defaultMessage="Claude is deciding which modules to include — usually five or six." />
            </li>
          )}
          {total > 0 && (
            <li className="course-plan-step active">
              <StepIcon done={done === total && total > 0} />
              <span>
                <FormattedMessage defaultMessage="Gathering readings, videos, and images" />
                {total > 0 && (
                  <span className="course-plan-count muted small">
                    {" "}
                    <FormattedMessage
                      defaultMessage="· {done}/{total}"
                      values={{ done, total }}
                    />
                  </span>
                )}
              </span>
            </li>
          )}
        </ol>

        {total > 0 && (
          <ul className="course-modules" aria-live="polite">
            {job.progress.modules.map((module, index) => {
              const moduleDone = job.progress.doneIndices.has(index);
              return (
                <li
                  key={index}
                  className={`course-module ${moduleDone ? "done" : "pending"}`}
                >
                  <ModuleStatus done={moduleDone} />
                  <span className="course-module-name">{module.name}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  if (job.stage === "error") {
    return (
      <div className="course-wizard">
        <p className="error small">{job.error}</p>
        <div className="course-wizard-actions">
          <button type="button" className="bg-action" onClick={onCancel}>
            <FormattedMessage defaultMessage="Close" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="course-wizard">
      <p className="muted small course-wizard-lede">
        <FormattedMessage defaultMessage="A few quick questions so the syllabus fits you." />
      </p>
      <ol className="course-wizard-questions">
        {job.questions.map((question, index) => (
          <li key={index}>
            <div className="course-wizard-prompt">{question.prompt}</div>
            {question.kind === "choice" && question.options.length > 0 ? (
              <div className="course-wizard-options">
                {question.options.map((option) => {
                  const selected = job.answers[index] === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      className={`course-wizard-option ${selected ? "selected" : ""}`}
                      aria-pressed={selected}
                      onClick={() => onAnswer(index, option)}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            ) : (
              <input
                type="text"
                className="course-wizard-input"
                value={job.answers[index] ?? ""}
                onChange={(event) => onAnswer(index, event.target.value)}
                placeholder={intl.formatMessage(msgs.answerPlaceholder)}
              />
            )}
          </li>
        ))}
      </ol>
      <div className="course-wizard-actions">
        <button type="button" className="bg-action ghost" onClick={onCancel}>
          <FormattedMessage defaultMessage="Cancel" />
        </button>
        <button type="button" className="bg-action" onClick={onSubmit}>
          <FormattedMessage defaultMessage="Generate course" />
        </button>
      </div>
    </div>
  );
}
