import { useMutation, useQueryClient } from "@tanstack/react-query";
import { login, signup, signOut, type AuthStatus } from "../lib/api";

export function useAuthMutations() {
  const qc = useQueryClient();
  const set = (data: AuthStatus) => qc.setQueryData(["auth"], data);

  const loginM = useMutation({
    mutationFn: (v: { username: string; password: string }) =>
      login(v.username, v.password),
    onSuccess: set,
  });
  const signupM = useMutation({
    mutationFn: (v: { username: string; password: string }) =>
      signup(v.username, v.password),
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
  return { login: loginM, signup: signupM, signOut: signOutM };
}
