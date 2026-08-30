import { Link, Navigate, useLocation } from "react-router-dom";

export type BrokerReturnResult = "connected" | "failed";

interface BrokerReturnCopy {
  eyebrow: string;
  title: string;
  message: string;
}

const returnCopy = {
  connected: {
    eyebrow: "ROBINHOOD AUTHORIZATION",
    title: "Authorization complete",
    message:
      "Signal received the Robinhood authorization. Return to your dashboard to see the connection status confirmed by your private trading runtime.",
  },
  failed: {
    eyebrow: "ROBINHOOD CONNECTION",
    title: "Connection failed",
    message:
      "Signal could not finish the Robinhood connection. Return to your dashboard and start the connection again.",
  },
} satisfies Record<BrokerReturnResult, BrokerReturnCopy>;

function BrokerReturnCard({ result }: { result: BrokerReturnResult }) {
  const copy = returnCopy[result];
  return (
    <main className="auth-stage">
      <section className="auth-card" aria-labelledby="broker-return-title">
        <div className="auth-mark" aria-hidden="true">
          S
        </div>
        <div className="eyebrow">{copy.eyebrow}</div>
        <h1 id="broker-return-title">{copy.title}</h1>
        <p role={result === "failed" ? "alert" : "status"}>{copy.message}</p>
        <Link className="primary-action auth-link" to="/" replace>
          Return to dashboard
        </Link>
      </section>
    </main>
  );
}

/**
 * The public Convex callback owns the OAuth code exchange. These routes never
 * read callback parameters. They replace any unexpected query or fragment
 * before the browser paints the result page.
 */
export function BrokerReturnPage({ result }: { result: BrokerReturnResult }) {
  const location = useLocation();
  if (location.search || location.hash) {
    return <Navigate to={location.pathname} replace />;
  }

  return <BrokerReturnCard result={result} />;
}

/**
 * Old deployments sent Robinhood back to this browser route. Never process a
 * code or state here. Replace the full URL with the public failure page.
 */
export function LegacyBrokerCallback() {
  return <Navigate to="/broker/failed" replace />;
}
