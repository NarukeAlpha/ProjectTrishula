import { useAuth } from "@workos-inc/authkit-react";
import { useConvexAuth } from "convex/react";
import { useState } from "react";
import { changeWorkOSAccount } from "./authRecovery";

export function AuthStage() {
  const { user, isLoading, signIn, signOut } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const convexAuth = useConvexAuth();
  const isChecking = isLoading || (user !== null && convexAuth.isLoading);
  const status = isLoading
    ? "Checking your WorkOS session…"
    : user && convexAuth.isLoading
      ? "Verifying your Signal access…"
      : (error ?? "Use your approved work account to continue.");

  return (
    <main className="auth-stage">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-mark" aria-hidden="true">
          S
        </div>
        <div className="eyebrow">SECURE TRADING COPILOT</div>
        <h1 id="auth-title">Signal</h1>
        <p
          role={error ? "alert" : "status"}
          data-state={error ? "error" : "normal"}
        >
          {status}
        </p>
        {user && !convexAuth.isLoading && !convexAuth.isAuthenticated ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              void changeWorkOSAccount(
                { signIn, signOut },
                window.location.origin,
              ).catch(() =>
                setError("WorkOS sign-in could not start. Try again."),
              );
            }}
          >
            Use another account
          </button>
        ) : (
          <button
            type="button"
            disabled={isChecking}
            onClick={() => {
              setError(null);
              void signIn().catch(() =>
                setError("WorkOS sign-in could not start. Try again."),
              );
            }}
          >
            {isChecking ? "Please wait…" : "Sign in with WorkOS"}
          </button>
        )}
        <small>
          Your Signal identity is secured by WorkOS. Brokerage access stays
          isolated from this browser.
        </small>
      </section>
    </main>
  );
}
