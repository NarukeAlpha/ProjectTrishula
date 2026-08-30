import { useMutation } from "convex/react";
import { useCallback } from "react";
import { publicApi } from "../convex/functions";
import type { CommandAccepted } from "../convex/types";
import { forgetCommand, rememberCommand } from "./recovery";

export class CommandUncertainError extends Error {
  constructor(readonly commandId: string) {
    super(
      "Signal could not confirm this command. It will check the canonical command status after reconnecting.",
    );
    this.name = "CommandUncertainError";
  }
}

interface SubmitPromptArgs {
  commandId: string;
  text: string;
  threadId?: string;
}

async function invokeIdempotently<TArgs, TResult extends CommandAccepted>(
  type: string,
  args: TArgs & { commandId: string },
  invoke: (args: TArgs & { commandId: string }) => Promise<TResult>,
): Promise<TResult> {
  rememberCommand(args.commandId, type);
  try {
    const accepted = await invoke(args);
    forgetCommand(args.commandId);
    return accepted;
  } catch {
    // One immediate repeat resolves a lost acknowledgement without creating a
    // second command because commandId is the server idempotency key.
    try {
      const accepted = await invoke(args);
      forgetCommand(args.commandId);
      return accepted;
    } catch {
      throw new CommandUncertainError(args.commandId);
    }
  }
}

export function useCommands() {
  const submitPromptMutation = useMutation(publicApi.commands.submitPrompt);
  const retryRunMutation = useMutation(publicApi.commands.retryRun);
  const requestStopMutation = useMutation(publicApi.commands.requestStop);
  const renameMutation = useMutation(publicApi.threads.rename);
  const archiveMutation = useMutation(publicApi.threads.archive);

  const submitPrompt = useCallback(
    (text: string, threadId?: string) => {
      const args: SubmitPromptArgs = {
        commandId: crypto.randomUUID(),
        text,
      };
      if (threadId) args.threadId = threadId;
      return invokeIdempotently("thread.prompt", args, submitPromptMutation);
    },
    [submitPromptMutation],
  );
  const retryRun = useCallback(
    (runId: string) => {
      const args = {
        commandId: crypto.randomUUID(),
        runId,
      };
      return invokeIdempotently("thread.retry", args, retryRunMutation);
    },
    [retryRunMutation],
  );
  const requestStop = useCallback(
    (runId: string) => {
      const args = {
        commandId: crypto.randomUUID(),
        runId,
      };
      return invokeIdempotently("thread.stop", args, requestStopMutation);
    },
    [requestStopMutation],
  );
  const renameThread = useCallback(
    (threadId: string, title: string) => {
      const args = {
        commandId: crypto.randomUUID(),
        threadId,
        title,
      };
      return invokeIdempotently("thread.rename", args, renameMutation);
    },
    [renameMutation],
  );
  const archiveThread = useCallback(
    (threadId: string) => {
      const args = {
        commandId: crypto.randomUUID(),
        threadId,
      };
      return invokeIdempotently("thread.archive", args, archiveMutation);
    },
    [archiveMutation],
  );

  return { archiveThread, renameThread, requestStop, retryRun, submitPrompt };
}
