interface LogFields {
  channelId?: string;
  code?: string;
  guildId?: string;
  loopId?: string;
  operation?: string;
  outboxId?: string;
}

function write(
  level: "info" | "warn" | "error",
  message: string,
  fields: LogFields = {},
): void {
  const record = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...fields,
  });
  if (level === "error") console.error(record);
  else if (level === "warn") console.warn(record);
  else console.log(record);
}

export const logger = {
  info(message: string, fields?: LogFields): void {
    write("info", message, fields);
  },
  warn(message: string, fields?: LogFields): void {
    write("warn", message, fields);
  },
  error(message: string, fields?: LogFields): void {
    write("error", message, fields);
  },
};
