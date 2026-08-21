import { useQuery } from "@tanstack/react-query";
import { fetchDailyQuiz, type DailyQuiz } from "../lib/api";

/**
 * Fetches today's quiz, or null when the user has no row for today (either
 * insufficient recent activity, feature disabled, or generation failed).
 */
export function useDailyQuiz(enabled: boolean) {
  return useQuery<DailyQuiz | null>({
    queryKey: ["daily-quiz"],
    queryFn: fetchDailyQuiz,
    enabled,
    // Cheap and rarely-changing — the panel refetches on window focus but
    // that's plenty.
    staleTime: 5 * 60 * 1000,
  });
}
