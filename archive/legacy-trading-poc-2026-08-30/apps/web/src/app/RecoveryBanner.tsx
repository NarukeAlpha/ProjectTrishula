import { useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import {
  forgetCommand,
  listPendingCommands,
  type PendingCommand,
} from "../commands/recovery";
import { publicApi } from "../convex/functions";
import type { CommandReadModel } from "../convex/types";

export function RecoveryNotice({
  initialPending,
  command,
}: {
  initialPending: PendingCommand | null;
  command: CommandReadModel | null | undefined;
}) {
  const [pending, setPending] = useState(initialPending);
  useEffect(() => {
    if (pending && command !== undefined) forgetCommand(pending.commandId);
  }, [command, pending]);

  function dismiss() {
    if (pending) forgetCommand(pending.commandId);
    setPending(null);
  }

  if (!pending || command === undefined) return null;
  if (command) {
    return (
      <div className="notice notice-with-action" role="status">
        <span>
          Recovered {pending.type.replace("thread.", "")} command:{" "}
          {command.status}.
        </span>
        <button type="button" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    );
  }
  return (
    <div className="notice warning notice-with-action" role="status">
      <span>
        The previous {pending.type.replace("thread.", "")} command was not
        found. Review the thread before you try again.
      </span>
      <button type="button" onClick={dismiss}>
        Dismiss
      </button>
    </div>
  );
}

export function RecoveryBanner() {
  const pending = useMemo(() => listPendingCommands().at(-1) ?? null, []);
  const command = useQuery(
    publicApi.commands.get,
    pending ? { commandId: pending.commandId } : "skip",
  );
  return <RecoveryNotice initialPending={pending} command={command} />;
}
