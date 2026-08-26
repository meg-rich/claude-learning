import { FormattedMessage } from "react-intl";
import { Navigate } from "react-router-dom";
import { SignIn } from "../components/SignIn";
import { useAuth } from "../hooks/auth";

export function SignInRoute() {
  const auth = useAuth();
  if (auth.isPending)
    return (
      <div className="centered muted">
        <FormattedMessage defaultMessage="Loading…" />
      </div>
    );
  if (auth.data?.authenticated === true) return <Navigate to="/" replace />;
  return <SignIn />;
}
