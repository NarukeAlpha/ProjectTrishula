export type PersonalitySurfaceViolation =
  | "chatbot_filler"
  | "canned_closing"
  | "emoji"
  | "em_dash"
  | "generic_disclaimer"
  | "markdown_heading";

const CHATBOT_FILLER = /\b(?:great question|certainly|absolutely|as an ai)\b/i;
const CANNED_CLOSING = /\b(?:hope this helps|let me know if you have any questions)\b/i;
const GENERIC_DISCLAIMER = /\b(?:not financial advice|do your own research)\b/i;
const MARKDOWN_HEADING = /(?:^|\n)\s*(?:#{1,6}\s|\*\*[^*]+\*\*\s*$)/m;
const EMOJI = /\p{Extended_Pictographic}/u;

/** Deterministic surface gates. A blind reviewer still owns the full 12-point rubric. */
export function inspectPersonalitySurface(text: string): PersonalitySurfaceViolation[] {
  const violations: PersonalitySurfaceViolation[] = [];
  if (CHATBOT_FILLER.test(text)) violations.push("chatbot_filler");
  if (CANNED_CLOSING.test(text)) violations.push("canned_closing");
  if (EMOJI.test(text)) violations.push("emoji");
  if (text.includes("—")) violations.push("em_dash");
  if (GENERIC_DISCLAIMER.test(text)) violations.push("generic_disclaimer");
  if (MARKDOWN_HEADING.test(text)) violations.push("markdown_heading");
  return violations;
}
