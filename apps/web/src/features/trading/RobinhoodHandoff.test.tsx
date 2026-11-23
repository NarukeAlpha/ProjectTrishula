import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RobinhoodHandoff } from "./RobinhoodHandoff";
import { RobinhoodMcpPanelView } from "./RobinhoodMcpPanel";
import { safeRobinhoodAuthorizationUrl } from "./robinhoodAuthorization";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Robinhood authorization URL validation", () => {
  it("accepts only an HTTPS URL on the exact Robinhood host", () => {
    expect(
      safeRobinhoodAuthorizationUrl(
        "https://robinhood.com/oauth?state=private-state&code_challenge=challenge",
      ),
    ).toBe(
      "https://robinhood.com/oauth?state=private-state&code_challenge=challenge",
    );

    for (const unsafeUrl of [
      "http://robinhood.com/oauth",
      "https://agent.robinhood.com/oauth",
      "https://robinhood.com.evil.example/oauth",
      "https://user:password@robinhood.com/oauth",
      "https://robinhood.com:8443/oauth",
      "javascript:alert(1)",
      "/oauth?state=relative",
    ]) {
      expect(safeRobinhoodAuthorizationUrl(unsafeUrl)).toBeNull();
    }
  });
});

describe("phone-first Robinhood handoff", () => {
  it("opens with no referrer and copies the private link without storage", async () => {
    const authorizationUrl =
      "https://robinhood.com/oauth?state=private-state&code_challenge=challenge";
    const writeText = vi.fn(async () => undefined);
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const onDismiss = vi.fn();

    render(
      <RobinhoodHandoff
        authorizationUrl={authorizationUrl}
        onDismiss={onDismiss}
      />,
    );

    const openLink = screen.getByRole("link", { name: "Open Robinhood" });
    expect(openLink).toHaveAttribute("href", authorizationUrl);
    expect(openLink).toHaveAttribute("target", "_blank");
    expect(openLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(openLink).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(
      screen.getByText(/It can expire.*verification prompt on your phone/s),
    ).toBeVisible();
    expect(
      screen.getByText(
        /If it expires, dismiss this message and tap Connect Robinhood for a new link/,
      ),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Copy private link" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(authorizationUrl),
    );
    expect(await screen.findByText("Private link copied.")).toBeVisible();
    expect(storageWrite).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("submits pasted loopback callback URLs and renders reauth_required guidance", async () => {
    const onCompleteAuthorization = vi.fn(async () => undefined);
    const onToggleConnection = vi.fn();

    const { rerender } = render(
      <RobinhoodMcpPanelView
        status="reauth_required"
        label="Robinhood"
        isMock={false}
        isLoading={false}
        operation={null}
        authorizationUrl={null}
        error={null}
        onToggleConnection={onToggleConnection}
        onCompleteAuthorization={onCompleteAuthorization}
        onDismissAuthorization={vi.fn()}
      />,
    );

    expect(screen.getByText("Reconnect required")).toBeVisible();
    expect(screen.getByText(/session expired/i)).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Reconnect Robinhood" }),
    );
    expect(onToggleConnection).toHaveBeenCalledOnce();

    rerender(
      <RobinhoodMcpPanelView
        status="connecting"
        label="Robinhood"
        isMock={false}
        isLoading={false}
        operation={null}
        authorizationUrl="https://robinhood.com/oauth?state=s1&code_challenge=c1"
        error={null}
        onToggleConnection={onToggleConnection}
        onCompleteAuthorization={onCompleteAuthorization}
        onDismissAuthorization={vi.fn()}
      />,
    );

    const input = screen.getByLabelText(
      /Step 2: Paste the redirected localhost URL/i,
    );
    fireEvent.change(input, {
      target: {
        value: "  http://127.0.0.1:8787/callback?code=code-1&state=s1  ",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Finish connection" }));

    await waitFor(() => {
      expect(onCompleteAuthorization).toHaveBeenCalledWith(
        "http://127.0.0.1:8787/callback?code=code-1&state=s1",
      );
    });
  });
});
