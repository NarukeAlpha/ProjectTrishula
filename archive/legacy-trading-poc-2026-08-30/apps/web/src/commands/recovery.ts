const storageKey = "signal.pending-command-ids:v1";
const maximumPending = 20;

export interface PendingCommand {
  commandId: string;
  type: string;
  createdAt: number;
}

function read(): PendingCommand[] {
  try {
    // SAFETY: This module is the only writer for this versioned session key.
    // A malformed external value is contained by this function's catch block.
    const value = JSON.parse(
      sessionStorage.getItem(storageKey) ?? "[]",
    ) as PendingCommand[];
    if (!Array.isArray(value)) return [];
    return value;
  } catch {
    return [];
  }
}

export function listPendingCommands(): PendingCommand[] {
  return read();
}

export function rememberCommand(commandId: string, type: string): void {
  const next = [
    ...read().filter((item) => item.commandId !== commandId),
    { commandId, type, createdAt: Date.now() },
  ];
  sessionStorage.setItem(
    storageKey,
    JSON.stringify(next.slice(-maximumPending)),
  );
}

export function forgetCommand(commandId: string): void {
  sessionStorage.setItem(
    storageKey,
    JSON.stringify(read().filter((item) => item.commandId !== commandId)),
  );
}
