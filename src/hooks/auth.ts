import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAuthStatus, login, signOut, type AuthStatus } from "../lib/api";

export function useAuth() {
  return useQuery<AuthStatus>({
    queryKey: ["auth"],
    queryFn: getAuthStatus,
    staleTime: Infinity,
  });
}

export function useAuthMutations() {
  const qc = useQueryClient();
  const set = (data: AuthStatus) => qc.setQueryData(["auth"], data);

  const loginM = useMutation({
    mutationFn: (v: { username: string; password: string }) =>
      login(v.username, v.password),
    onSuccess: set,
  });
  const signOutM = useMutation({
    mutationFn: signOut,
    onSuccess: (data) => {
      set(data);
      qc.removeQueries({ queryKey: ["chats"] });
      qc.removeQueries({ queryKey: ["chat"] });
    },
  });
  return { login: loginM, signOut: signOutM };
}
