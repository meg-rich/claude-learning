import { useState, type FormEvent } from "react";
import { FormattedMessage, defineMessages, useIntl } from "react-intl";
import { useAuthMutations } from "../hooks/auth";
import "./SignIn.css";

type Mode = "login" | "signup";

const msgs = defineMessages({
  usernamePlaceholder: { defaultMessage: "jane" },
  passwordPlaceholder: { defaultMessage: "at least 8 characters" },
  usernameAria: { defaultMessage: "Username" },
  passwordAria: { defaultMessage: "Password" },
  signupFailed: { defaultMessage: "Sign-up failed." },
  signinFailed: { defaultMessage: "Sign-in failed." },
});

export function SignIn() {
  const intl = useIntl();
  const { login, signup } = useAuthMutations();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const active = mode === "signup" ? signup : login;
  const busy = active.isPending;
  const canSubmit = username.trim().length >= 3 && password.length >= 8;

  const errorMessage =
    active.error instanceof Error
      ? active.error.message
      : active.error
        ? intl.formatMessage(mode === "signup" ? msgs.signupFailed : msgs.signinFailed)
        : null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    // Reset the other mutation's error so mode switches show a clean slate.
    (mode === "signup" ? login : signup).reset();
    try {
      if (mode === "signup") {
        await signup.mutateAsync({ username: username.trim(), password });
      } else {
        await login.mutateAsync({ username: username.trim(), password });
      }
    } catch {
      /* error surfaces via active.error */
    }
  }

  return (
    <div className="centered">
      <form className="signin" onSubmit={handleSubmit}>
        <h1>
          <FormattedMessage defaultMessage="claude-background" />
        </h1>
        <p className="muted">
          {mode === "signup" ? (
            <FormattedMessage defaultMessage="Pick a username and password. They're stored on the server; a session cookie keeps you signed in." />
          ) : (
            <FormattedMessage defaultMessage="Sign in to pick up your chats. New here?" />
          )}{" "}
          <button
            type="button"
            className="link"
            onClick={() => {
              setMode(mode === "signup" ? "login" : "signup");
              login.reset();
              signup.reset();
            }}
          >
            {mode === "signup" ? (
              <FormattedMessage defaultMessage="Sign in instead." />
            ) : (
              <FormattedMessage defaultMessage="Create an account." />
            )}
          </button>
        </p>

        <label className="field">
          <span className="muted small">
            <FormattedMessage defaultMessage="Username" />
          </span>
          <input
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder={intl.formatMessage(msgs.usernamePlaceholder)}
            autoComplete="username"
            spellCheck={false}
            minLength={3}
            maxLength={32}
            aria-label={intl.formatMessage(msgs.usernameAria)}
          />
        </label>

        <label className="field">
          <span className="muted small">
            <FormattedMessage defaultMessage="Password" />
          </span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={intl.formatMessage(msgs.passwordPlaceholder)}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            minLength={8}
            aria-label={intl.formatMessage(msgs.passwordAria)}
          />
        </label>

        {errorMessage && <p className="error">{errorMessage}</p>}
        <button type="submit" disabled={busy || !canSubmit}>
          {busy ? (
            mode === "signup" ? (
              <FormattedMessage defaultMessage="Creating…" />
            ) : (
              <FormattedMessage defaultMessage="Signing in…" />
            )
          ) : mode === "signup" ? (
            <FormattedMessage defaultMessage="Create account" />
          ) : (
            <FormattedMessage defaultMessage="Sign in" />
          )}
        </button>
      </form>
    </div>
  );
}
