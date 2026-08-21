import { useState } from "react";
import { FormattedMessage, defineMessages, useIntl } from "react-intl";
import { useDailyQuiz } from "../queries/useDailyQuiz";
import { useDailyQuizMutations } from "../mutations/useDailyQuizMutations";
import { Quiz } from "./Quiz";

const msgs = defineMessages({
  panelAria: { defaultMessage: "Daily review quiz" },
  regenerateAria: { defaultMessage: "Regenerate today's quiz" },
  regenerateTitle: { defaultMessage: "Regenerate" },
  dismissAria: { defaultMessage: "Hide today's quiz" },
  dismissTitle: { defaultMessage: "Hide until tomorrow" },
  reopenAria: { defaultMessage: "Reopen today's completed quiz" },
});

type Props = {
  /** When false, the panel doesn't render (used to hide it on unauthenticated
   *  routes and while auth is loading). */
  enabled: boolean;
};

/**
 * Floating panel, top right. Pulls today's pregenerated quiz on mount and
 * renders one of four states:
 *   - dismissed: nothing renders
 *   - completed (not dismissed): a small pill with the score; click to review
 *   - fresh: intro card with a Start button
 *   - in progress: the shared Quiz component with results posting on completion
 *
 * The regenerate button (circular arrow) is always in the header while the
 * panel is showing, disabled while a regen is in flight.
 */
export function DailyQuizPanel({ enabled }: Props) {
  const intl = useIntl();
  const { data: quiz } = useDailyQuiz(enabled);
  const { submit, regenerate, dismiss } = useDailyQuizMutations();
  const [started, setStarted] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  if (!enabled || !quiz) return null;
  if (quiz.dismissedAt !== null) return null;

  const isCompleted = quiz.completedAt !== null && quiz.answers !== null;
  const isRegenerating = regenerate.isPending;

  // Completed-but-not-reopened: show the small pill.
  if (isCompleted && !reviewing) {
    return (
      <aside
        className="dq-pill-wrap"
        aria-label={intl.formatMessage(msgs.panelAria)}
      >
        <button
          type="button"
          className="dq-pill"
          onClick={() => setReviewing(true)}
          aria-label={intl.formatMessage(msgs.reopenAria)}
        >
          <span className="dq-pill-check" aria-hidden="true">✓</span>
          <FormattedMessage defaultMessage="Quiz" />
          <span className="dq-pill-score">
            {quiz.score}/{quiz.questions.length}
          </span>
        </button>
        <button
          type="button"
          className="dq-pill-close"
          aria-label={intl.formatMessage(msgs.dismissAria)}
          title={intl.formatMessage(msgs.dismissTitle)}
          onClick={() => dismiss.mutate()}
          disabled={dismiss.isPending}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </aside>
    );
  }

  return (
    <aside className="dq-panel" aria-label={intl.formatMessage(msgs.panelAria)}>
      <div className="dq-hd">
        <div className="dq-hd-text">
          <div className="dq-eyebrow">
            <span className="dq-dot" aria-hidden="true" />
            <FormattedMessage defaultMessage="Daily review" />
          </div>
          <h2 className="dq-title">
            <FormattedMessage
              defaultMessage="{n, plural, one {# question} other {# questions}} from the last few weeks"
              values={{ n: quiz.questions.length }}
            />
          </h2>
        </div>
        <div className="dq-hd-actions">
          <button
            type="button"
            className="dq-icon-btn"
            aria-label={intl.formatMessage(msgs.regenerateAria)}
            title={intl.formatMessage(msgs.regenerateTitle)}
            onClick={() => {
              setStarted(false);
              setReviewing(false);
              regenerate.mutate();
            }}
            disabled={isRegenerating}
          >
            {isRegenerating ? (
              <span className="dq-spin" aria-hidden="true" />
            ) : (
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M21 12a9 9 0 1 1-3-6.7" />
                <path d="M21 4v5h-5" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="dq-icon-btn"
            aria-label={intl.formatMessage(msgs.dismissAria)}
            title={intl.formatMessage(msgs.dismissTitle)}
            onClick={() => dismiss.mutate()}
            disabled={dismiss.isPending}
          >
            <svg
              width="13"
              height="13"
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
        </div>
      </div>

      {regenerate.isError && (
        <p className="dq-error small">
          {regenerate.error instanceof Error
            ? regenerate.error.message
            : intl.formatMessage({ defaultMessage: "Could not regenerate." })}
        </p>
      )}

      <div className="dq-body">
        {reviewing && quiz.answers && quiz.score !== null ? (
          <Quiz
            questions={quiz.questions}
            reviewOf={{ answers: quiz.answers, score: quiz.score }}
          />
        ) : started ? (
          <Quiz
            questions={quiz.questions}
            onComplete={(answers) => {
              submit.mutate(answers);
            }}
          />
        ) : (
          <div className="dq-intro">
            <p className="muted small dq-intro-sub">
              <FormattedMessage defaultMessage="Concepts you've been learning across chats. Same MCQ format as the Learn panel." />
            </p>
            <button
              type="button"
              className="bg-action primary"
              onClick={() => setStarted(true)}
            >
              <FormattedMessage defaultMessage="Start" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
