import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { listPendingCommands, rememberCommand } from "../commands/recovery";
import type { CommandReadModel } from "../convex/types";
import { RecoveryNotice } from "./RecoveryBanner";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe("command recovery banner", () => {
  it("keeps unresolved recovery state while the canonical query loads", () => {
    rememberCommand("command_1", "thread.stop");
    const pending = listPendingCommands().at(-1) ?? null;

    render(<RecoveryNotice initialPending={pending} command={undefined} />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(listPendingCommands()).toHaveLength(1);
  });

  it("clears a missing command and lets the user dismiss its warning", async () => {
    rememberCommand("command_1", "thread.stop");
    const pending = listPendingCommands().at(-1) ?? null;

    render(<RecoveryNotice initialPending={pending} command={null} />);

    expect(
      screen.getByText(/previous stop command was not found/i),
    ).toBeInTheDocument();
    await waitFor(() => expect(listPendingCommands()).toHaveLength(0));

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("clears and reports a recovered canonical command", async () => {
    rememberCommand("command_1", "thread.prompt");
    const pending = listPendingCommands().at(-1) ?? null;
    const command: CommandReadModel = {
      commandId: "command_1",
      type: "thread.prompt",
      status: "completed",
      threadId: "thread_1",
      runId: "run_1",
      dispatchAttempts: 1,
      createdAt: 1,
      updatedAt: 2,
    };

    render(<RecoveryNotice initialPending={pending} command={command} />);

    expect(
      screen.getByText("Recovered prompt command: completed."),
    ).toBeInTheDocument();
    await waitFor(() => expect(listPendingCommands()).toHaveLength(0));
  });
});
