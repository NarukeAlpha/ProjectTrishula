export type LogValue = string | number | boolean | null | readonly LogValue[] | { readonly [key: string]: LogValue };
export type LogDetails = Readonly<Record<string, LogValue>>;

export interface Logger {
  info(event: string, details?: LogDetails): void;
  warn(event: string, details?: LogDetails): void;
  error(event: string, details?: LogDetails): void;
}

function write(
  level: "info" | "warn" | "error",
  event: string,
  details: LogDetails = {},
): void {
  console[level](JSON.stringify({ level, event, ...details }));
}

export const consoleLogger: Logger = {
  info: (event, details) => write("info", event, details),
  warn: (event, details) => write("warn", event, details),
  error: (event, details) => write("error", event, details),
};
