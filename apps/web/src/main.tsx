import { AuthKitProvider } from "@workos-inc/authkit-react";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app/App";
import { AppErrorBoundary } from "./app/AppErrorBoundary";
import { getRuntimeConfig } from "./config/runtime";
import { ConvexSessionProvider } from "./convex/client";
import "./styles.css";

const DemoApp = lazy(() =>
  import("./demo/DemoApp").then((module) => ({ default: module.DemoApp })),
);

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("The application root is missing.");

try {
  const config = getRuntimeConfig();
  document.title = config.applicationName;
  const application = config.demoMode ? (
    <BrowserRouter>
      <Suspense
        fallback={
          <main className="auth-stage" role="status">
            Loading Project Trishula…
          </main>
        }
      >
        <DemoApp config={config} />
      </Suspense>
    </BrowserRouter>
  ) : (
    <AuthKitProvider
      clientId={config.workosClientId}
      redirectUri={config.workosRedirectUri}
      onRefreshFailure={({ signIn }) => {
        void signIn();
      }}
      {...(config.workosApiHostname
        ? { apiHostname: config.workosApiHostname }
        : {})}
    >
      <ConvexSessionProvider config={config}>
        <BrowserRouter>
          <App config={config} />
        </BrowserRouter>
      </ConvexSessionProvider>
    </AuthKitProvider>
  );
  createRoot(rootElement).render(
    <StrictMode>
      <AppErrorBoundary>{application}</AppErrorBoundary>
    </StrictMode>,
  );
} catch (error) {
  const message =
    error instanceof Error ? error.message : "The application could not start.";
  const main = document.createElement("main");
  const section = document.createElement("section");
  const title = document.createElement("h1");
  const paragraph = document.createElement("p");
  main.className = "fatal";
  title.textContent = "Trishula could not start";
  paragraph.textContent = message;
  section.append(title, paragraph);
  main.append(section);
  rootElement.replaceChildren(main);
}
