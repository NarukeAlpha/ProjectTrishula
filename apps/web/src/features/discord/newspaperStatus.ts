export function newspaperFailureMessage(code: string): string {
  if (code === "market_research_disabled") {
    return "Research service setup is incomplete. Research workers must be enabled before an edition can run.";
  }
  return code;
}

export function newspaperPreviewSummary(
  lines: readonly string[],
  safeFailure?: string,
): readonly string[] {
  return lines.filter(
    (line) =>
      safeFailure === undefined ||
      line !== `Preview stopped with safe failure ${safeFailure}.`,
  );
}
