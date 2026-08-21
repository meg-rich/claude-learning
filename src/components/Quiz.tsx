import { useState } from "react";
import { FormattedMessage } from "react-intl";
import type { QuizQuestion } from "../lib/api";

type Props = {
  questions: QuizQuestion[];
  /** Fired once when the user reaches the results screen — used by the
   *  daily-quiz panel to persist answers to the server. Not called on retry. */
  onComplete?: (answers: number[], score: number) => void;
  /** When true, the quiz starts already in the "done" state showing the score,
   *  with previously picked answers marked. Used to render historical results. */
  reviewOf?: { answers: number[]; score: number };
};

/**
 * The interactive MCQ card. One question at a time; the user clicks an option,
 * the panel reveals which was correct and shows the per-option explanation,
 * then a Next button advances. State lives here — the quiz belongs to whichever
 * panel mounted it, so a re-render of the surrounding topic list does not
 * restart it. Once the last question is answered, we show a summary line.
 */
export function Quiz({ questions, onComplete, reviewOf }: Props) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [correctCount, setCorrectCount] = useState(reviewOf?.score ?? 0);
  const [done, setDone] = useState(reviewOf !== undefined);
  const [picks, setPicks] = useState<number[]>(reviewOf?.answers ?? []);

  const question = questions[index];
  if (!question) return null;

  function choose(optionIndex: number) {
    if (picked !== null || !question) return;
    setPicked(optionIndex);
    setPicks((prev) => [...prev, optionIndex]);
    if (question.options[optionIndex]?.correct) setCorrectCount((prev) => prev + 1);
  }

  function next() {
    if (index + 1 >= questions.length) {
      setDone(true);
      const nextScore = correctCount;
      onComplete?.(picks, nextScore);
      return;
    }
    setIndex(index + 1);
    setPicked(null);
  }

  function reset() {
    setIndex(0);
    setPicked(null);
    setCorrectCount(0);
    setDone(false);
    setPicks([]);
  }

  if (done) {
    return (
      <div className="bg-quiz bg-quiz-done">
        <div className="bg-quiz-summary">
          <FormattedMessage
            defaultMessage="You got <strong>{correctCount}</strong> of <strong>{total}</strong> right."
            values={{
              correctCount,
              total: questions.length,
              strong: (chunks) => <strong>{chunks}</strong>,
            }}
          />
        </div>
        <button type="button" className="bg-action" onClick={reset}>
          <FormattedMessage defaultMessage="Retry quiz" />
        </button>
      </div>
    );
  }

  return (
    <div className="bg-quiz">
      <div className="bg-quiz-progress muted small">
        <FormattedMessage
          defaultMessage="Question {current} of {total}"
          values={{ current: index + 1, total: questions.length }}
        />
      </div>
      <div className="bg-quiz-prompt">{question.prompt}</div>
      <ol className="bg-quiz-options">
        {question.options.map((option, i) => {
          const isPicked = picked === i;
          const revealed = picked !== null;
          const state = !revealed
            ? "idle"
            : option.correct
              ? "correct"
              : isPicked
                ? "wrong"
                : "muted";
          return (
            <li key={i} className={`bg-quiz-option ${state} ${isPicked ? "picked" : ""}`}>
              <button
                type="button"
                onClick={() => choose(i)}
                disabled={revealed}
                aria-pressed={isPicked}
              >
                <span className="bg-quiz-marker" aria-hidden="true">
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="bg-quiz-text">{option.text}</span>
              </button>
              {revealed && (isPicked || option.correct) && (
                <p className="bg-quiz-why muted small">{option.why}</p>
              )}
            </li>
          );
        })}
      </ol>
      {picked !== null && (
        <button type="button" className="bg-action primary bg-quiz-next" onClick={next}>
          {index + 1 >= questions.length ? (
            <FormattedMessage defaultMessage="See results" />
          ) : (
            <FormattedMessage defaultMessage="Next question" />
          )}
        </button>
      )}
    </div>
  );
}
