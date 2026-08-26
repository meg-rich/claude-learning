import { useEffect, useRef, useState } from "react";
import { FormattedMessage, defineMessages, useIntl } from "react-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  dismissDailyQuiz,
  fetchDailyQuiz,
  regenerateDailyQuiz,
  submitDailyQuizAnswers,
  type DailyQuiz,
} from "../lib/api";
import { Quiz } from "./Quiz";
import "./DailyQuizPanel.css";

/**
 * Fetches today's quiz, or null when the user has no row for today (either
 * insufficient recent activity, feature disabled, or generation failed).
 */
function useDailyQuiz(enabled: boolean) {
  return useQuery<DailyQuiz | null>({
    queryKey: ["daily-quiz"],
    queryFn: fetchDailyQuiz,
    enabled,
    // Cheap and rarely-changing — the panel refetches on window focus but
    // that's plenty.
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Mutations for the four side-effectful daily-quiz endpoints. All three set
 * the ["daily-quiz"] query cache directly with the row the server returned,
 * so the panel updates without a refetch.
 */
function useDailyQuizMutations() {
  const qc = useQueryClient();
  const set = (quiz: DailyQuiz) => qc.setQueryData(["daily-quiz"], quiz);

  const submit = useMutation({
    mutationFn: (answers: number[]) => submitDailyQuizAnswers(answers),
    onSuccess: set,
  });
  const regenerate = useMutation({
    mutationFn: regenerateDailyQuiz,
    onSuccess: set,
  });
  const dismiss = useMutation({
    mutationFn: dismissDailyQuiz,
    onSuccess: set,
  });

  return { submit, regenerate, dismiss };
}

const msgs = defineMessages({
  panelAria: { defaultMessage: "Daily review quiz" },
  dismissAria: { defaultMessage: "Hide today's quiz" },
  dismissTitle: { defaultMessage: "Hide until tomorrow" },
  minimizeAria: { defaultMessage: "Minimize quiz to a pill" },
  minimizeTitle: { defaultMessage: "Minimize" },
  reopenAria: { defaultMessage: "Reopen today's completed quiz" },
  fabRegenerateLabel: { defaultMessage: "New quiz" },
  fabGenerateLabel: { defaultMessage: "Generate quiz" },
  fabGeneratingLabel: { defaultMessage: "Generating…" },
});

/**
 * Always-on floating button, bottom-left. Generates today's quiz if none
 * exists, or regenerates in place if one does. Kept outside the panel so the
 * action is reachable even when the panel is dismissed or minimized.
 * Regenerate errors surface as a small pill above the button.
 */
export function DailyQuizFab({ enabled }: { enabled: boolean }) {
  const intl = useIntl();
  const { data: quiz } = useDailyQuiz(enabled);
  const { regenerate } = useDailyQuizMutations();
  if (!enabled) return null;
  const label = regenerate.isPending
    ? intl.formatMessage(msgs.fabGeneratingLabel)
    : quiz
      ? intl.formatMessage(msgs.fabRegenerateLabel)
      : intl.formatMessage(msgs.fabGenerateLabel);
  const errorMsg =
    regenerate.error instanceof Error ? regenerate.error.message : null;
  return (
    <div className="dq-fab-wrap">
      {errorMsg && <div className="dq-fab-error small">{errorMsg}</div>}
      <button
        type="button"
        className="dq-fab"
        onClick={() => regenerate.mutate()}
        disabled={regenerate.isPending}
        title={label}
      >
        {regenerate.isPending ? (
          <span className="dq-spin" aria-hidden="true" />
        ) : (
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
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <path d="M21 4v5h-5" />
          </svg>
        )}
        <span>{label}</span>
      </button>
    </div>
  );
}

/**
 * Positive framing shown on the results screen no matter the score. The point
 * of the daily quiz is retention — showing up and thinking through recent
 * concepts. Getting them all right is not the target.
 */
function CompletionBanner() {
  return (
    <div className="dq-celebrate" role="status">
      <span className="dq-celebrate-check" aria-hidden="true">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12l5 5L20 7" />
        </svg>
      </span>
      <div className="dq-celebrate-text">
        <strong>
          <FormattedMessage defaultMessage="Nice — you showed up." />
        </strong>
        <span className="muted small">
          <FormattedMessage defaultMessage="Retention comes from the reps, not the score." />
        </span>
      </div>
    </div>
  );
}

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
/** Small × icon used by the minimize/dismiss buttons and the pill close. */
function CloseIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

export function DailyQuizPanel({ enabled }: Props) {
  const intl = useIntl();
  const { data: quiz } = useDailyQuiz(enabled);
  const { submit, dismiss } = useDailyQuizMutations();
  const [started, setStarted] = useState(false);
  const [collapsedByUser, setCollapsedByUser] = useState(false);

  // Reset local view state whenever a fresh quiz row appears — a regenerate
  // (from the floating FAB or anywhere else) should land the user back on the
  // intro card, not a stale mid-quiz state.
  const lastSeenGenAt = useRef<number | null>(quiz?.generatedAt ?? null);
  useEffect(() => {
    if (!quiz) {
      lastSeenGenAt.current = null;
      return;
    }
    if (lastSeenGenAt.current !== null && lastSeenGenAt.current !== quiz.generatedAt) {
      setStarted(false);
      setCollapsedByUser(false);
    }
    lastSeenGenAt.current = quiz.generatedAt;
  }, [quiz]);

  if (!enabled) return null;

  // Panel renders only when a quiz row exists for today. The always-on
  // "Generate quiz" FAB (bottom left) is the trigger for creating one.
  if (!quiz) return null;
  if (quiz.dismissedAt !== null) return null;

  const isCompleted = quiz.completedAt !== null && quiz.answers !== null;
  // Reviewable = the server has stored answers we can hand to Quiz as reviewOf.
  // Right after `submit` this becomes true, so a mid-quiz Quiz mount is
  // replaced by a review-mode mount showing the same score.
  const canReview =
    isCompleted && quiz.answers !== null && quiz.score !== null;

  // Pill label reflects where the user is: pre-start, in-progress, or done.
  const pillState: "ready" | "in-progress" | "done" = canReview
    ? "done"
    : started
      ? "in-progress"
      : "ready";

  const pill = (
    <aside
      className="dq-pill-wrap"
      aria-label={intl.formatMessage(msgs.panelAria)}
    >
      <button
        type="button"
        className="dq-pill"
        onClick={() => setCollapsedByUser(false)}
        aria-label={intl.formatMessage(msgs.reopenAria)}
      >
        {pillState === "done" ? (
          <>
            <span className="dq-pill-check" aria-hidden="true">✓</span>
            <FormattedMessage defaultMessage="Quiz" />
            <span className="dq-pill-score">
              {quiz.score}/{quiz.questions.length}
            </span>
          </>
        ) : pillState === "in-progress" ? (
          <>
            <span className="dq-dot" aria-hidden="true" />
            <FormattedMessage defaultMessage="Quiz" />
            <span className="dq-pill-score">
              <FormattedMessage defaultMessage="In progress" />
            </span>
          </>
        ) : (
          <>
            <span className="dq-dot" aria-hidden="true" />
            <FormattedMessage defaultMessage="Quiz" />
            <span className="dq-pill-score">
              <FormattedMessage defaultMessage="Ready" />
            </span>
          </>
        )}
      </button>
      <button
        type="button"
        className="dq-pill-close"
        aria-label={intl.formatMessage(msgs.dismissAria)}
        title={intl.formatMessage(msgs.dismissTitle)}
        onClick={() => dismiss.mutate()}
        disabled={dismiss.isPending}
      >
        <CloseIcon size={10} />
      </button>
    </aside>
  );

  // Render pill AND panel; hide the panel with a class instead of unmounting
  // so the Quiz component keeps its in-progress state across collapse/expand.
  return (
    <>
      {collapsedByUser && pill}
      <aside
        className={`dq-panel${collapsedByUser ? " dq-panel-hidden" : ""}`}
        aria-label={intl.formatMessage(msgs.panelAria)}
        aria-hidden={collapsedByUser ? "true" : undefined}
      >
        <div className="dq-hd">
          <div className="dq-hd-text">
            <div className="dq-eyebrow">
              <span className="dq-dot" aria-hidden="true" />
              <FormattedMessage defaultMessage="Learn" />
            </div>
            <h2 className="dq-title">
              <FormattedMessage
                defaultMessage="Daily Review"
                values={{ n: quiz.questions.length }}
              />
            </h2>
            <p className="dq-subtitle muted small">
              <FormattedMessage defaultMessage="Test your knowledge" />
            </p>
          </div>
          <div className="dq-hd-actions">
            <button
              type="button"
              className="dq-icon-btn"
              aria-label={intl.formatMessage(msgs.minimizeAria)}
              title={intl.formatMessage(msgs.minimizeTitle)}
              onClick={() => setCollapsedByUser(true)}
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
                <path d="M5 12h14" />
              </svg>
            </button>
            <button
              type="button"
              className="dq-icon-btn"
              aria-label={intl.formatMessage(msgs.dismissAria)}
              title={intl.formatMessage(msgs.dismissTitle)}
              onClick={() => dismiss.mutate()}
              disabled={dismiss.isPending}
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        <div className="dq-body">
          {canReview ? (
            <Quiz
              questions={quiz.questions}
              reviewOf={{ answers: quiz.answers!, score: quiz.score! }}
              completionBanner={<CompletionBanner />}
              completionActions={
                <button
                  type="button"
                  className="bg-action primary bg-quiz-next"
                  onClick={() => dismiss.mutate()}
                  disabled={dismiss.isPending}
                >
                  <FormattedMessage defaultMessage="Done" />
                </button>
              }
            />
          ) : started ? (
            <Quiz
              questions={quiz.questions}
              onComplete={(answers) => submit.mutate(answers)}
              completionBanner={<CompletionBanner />}
              completionActions={
                <button
                  type="button"
                  className="bg-action primary bg-quiz-next"
                  onClick={() => dismiss.mutate()}
                  disabled={dismiss.isPending}
                >
                  <FormattedMessage defaultMessage="Done" />
                </button>
              }
            />
          ) : (
            <div className="dq-intro">
              <p className="muted small dq-intro-sub">
                <FormattedMessage defaultMessage="Review concepts you've been learning across chats." />
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
    </>
  );
}
