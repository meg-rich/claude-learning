import { useState, type FormEvent } from "react";
import { FormattedMessage, defineMessages, useIntl } from "react-intl";
import { useAuthMutations } from "../hooks/auth";
import "./SignIn.css";

const msgs = defineMessages({
  usernamePlaceholder: { defaultMessage: "jane" },
  passwordPlaceholder: { defaultMessage: "at least 8 characters" },
  usernameAria: { defaultMessage: "Username" },
  passwordAria: { defaultMessage: "Password" },
  signinFailed: { defaultMessage: "Sign-in failed." },
});

export function SignIn() {
  const intl = useIntl();
  const { login } = useAuthMutations();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const busy = login.isPending;
  const canSubmit = username.trim().length >= 3 && password.length >= 8;

  const errorMessage =
    login.error instanceof Error
      ? login.error.message
      : login.error
        ? intl.formatMessage(msgs.signinFailed)
        : null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    try {
      await login.mutateAsync({ username: username.trim(), password });
    } catch {
      /* error surfaces via login.error */
    }
  }

  return (
    <div className="centered">
      <form className="signin" onSubmit={handleSubmit}>
        <h1>
          <FormattedMessage defaultMessage="claude-learning" />
        </h1>
        <p className="muted">
          <FormattedMessage defaultMessage="Sign in to pick up your chats." />
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
            autoComplete="current-password"
            minLength={8}
            aria-label={intl.formatMessage(msgs.passwordAria)}
          />
        </label>

        {errorMessage && <p className="error">{errorMessage}</p>}
        <button type="submit" disabled={busy || !canSubmit}>
          {busy ? (
            <FormattedMessage defaultMessage="Signing in…" />
          ) : (
            <FormattedMessage defaultMessage="Sign in" />
          )}
        </button>
      </form>
    </div>
  );
}
