const relativeTime = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});
const standardNumber = new Intl.NumberFormat();
const compactNumber = new Intl.NumberFormat(undefined, { notation: "compact" });

export function formatAge(timestamp: number): string {
  const elapsed = timestamp - Date.now();
  const minutes = Math.round(elapsed / 60_000);
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relativeTime.format(hours, "hour");
  return relativeTime.format(Math.round(hours / 24), "day");
}

export function formatDuration(milliseconds?: number | null): string | null {
  if (milliseconds === undefined || milliseconds === null) return null;
  return milliseconds < 1_000
    ? `${Math.round(milliseconds)} ms`
    : `${(milliseconds / 1_000).toFixed(1)} s`;
}

export function formatTokens(tokens?: number): string | null {
  if (tokens === undefined) return null;
  return (tokens >= 10_000 ? compactNumber : standardNumber).format(tokens);
}
