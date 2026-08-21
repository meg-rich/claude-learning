import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  dismissDailyQuiz,
  regenerateDailyQuiz,
  submitDailyQuizAnswers,
  type DailyQuiz,
} from "../lib/api";

/**
 * Mutations for the four side-effectful daily-quiz endpoints. All three set
 * the ["daily-quiz"] query cache directly with the row the server returned,
 * so the panel updates without a refetch.
 */
export function useDailyQuizMutations() {
  const qc = useQueryClient();

  const submit = useMutation({
    mutationFn: (answers: number[]) => submitDailyQuizAnswers(answers),
    onSuccess: (quiz: DailyQuiz) => {
      qc.setQueryData(["daily-quiz"], quiz);
    },
  });

  const regenerate = useMutation({
    mutationFn: regenerateDailyQuiz,
    onSuccess: (quiz: DailyQuiz) => {
      qc.setQueryData(["daily-quiz"], quiz);
    },
  });

  const dismiss = useMutation({
    mutationFn: dismissDailyQuiz,
    onSuccess: (quiz: DailyQuiz) => {
      qc.setQueryData(["daily-quiz"], quiz);
    },
  });

  return { submit, regenerate, dismiss };
}
