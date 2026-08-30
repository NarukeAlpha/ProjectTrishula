import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Signal render failure", {
      name: error.name,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="fatal">
        <section>
          <div className="brand-mark" aria-hidden="true">
            S
          </div>
          <h1>Signal needs to reload</h1>
          <p>
            The application could not render the latest state. No command was
            sent by this error.
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload application
          </button>
        </section>
      </main>
    );
  }
}
