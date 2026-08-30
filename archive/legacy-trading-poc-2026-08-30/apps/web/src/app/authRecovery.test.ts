import { describe, expect, it, vi } from "vitest";
import { changeWorkOSAccount } from "./authRecovery";

describe("WorkOS recovery", () => {
  it("starts a fresh sign-in when a stale session cannot sign out", async () => {
    const signIn = vi.fn(async () => undefined);
    const signOut = vi.fn(async () => {
      throw new Error("Missing active session");
    });

    await changeWorkOSAccount({ signIn, signOut }, "https://signal.example");

    expect(signOut).toHaveBeenCalledWith({
      returnTo: "https://signal.example",
    });
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("does not start another sign-in when sign-out succeeds", async () => {
    const signIn = vi.fn(async () => undefined);
    const signOut = vi.fn(async () => undefined);

    await changeWorkOSAccount({ signIn, signOut }, "https://signal.example");

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signIn).not.toHaveBeenCalled();
  });
});
