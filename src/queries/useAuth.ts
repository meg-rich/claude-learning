import { useQuery } from "@tanstack/react-query";
import { getAuthStatus, type AuthStatus } from "../lib/api";

export function useAuth() {
  return useQuery<AuthStatus>({
    queryKey: ["auth"],
    queryFn: getAuthStatus,
    staleTime: Infinity,
  });
}
