interface ProtectedRange {
  start: number;
  end: number;
}

const markdownLink = /\[[^\]\n]+\]\(https:\/\/[^\s)]+(?:\([^\s)]*\)[^\s)]*)*\)/gu;
const plainUrl = /https:\/\/[^\s<>{}\u005b\u005d]+/gu;
const citationMarker = /\[[A-Za-z0-9:._-]{1,256}\]/gu;
const atomicReportLine = /^(?:[-*+]\s|\d+[.)]\s|[A-Z][A-Z0-9.^=-]{0,19}\s*(?::|\||-|—))[^\n]*(?:\n|$)/gmu;
const fencedCodeBlock = /```[^\n]*\n[\s\S]*?```(?:\n|$)/gu;

function protectedRanges(content: string, maximumReportLine = Infinity): ProtectedRange[] {
  const ranges: ProtectedRange[] = [];
  for (const pattern of [markdownLink, plainUrl, citationMarker, atomicReportLine, fencedCodeBlock]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const start = match.index;
      let end = start + match[0].length;
      // Keep ordinary report rows together, but let a row longer than one Discord
      // part use normal sentence/word boundaries. Its links and citations remain
      // independently protected by the other patterns.
      if (pattern === atomicReportLine && end - start > maximumReportLine) continue;
      if (pattern === plainUrl) {
        while (end > start && /[.,;:!?)]/u.test(content[end - 1] ?? "")) end -= 1;
      }
      if (end > start) ranges.push({ start, end });
    }
  }
  return ranges
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .filter((range, index, values) => !values.slice(0, index).some((earlier) => earlier.start <= range.start && earlier.end >= range.end));
}

export function neutralizeUntrustedDiscordMarkdown(content: string): string {
  return content
    .replace(/@(everyone|here)\b/giu, "@\u200b$1")
    .replace(/<(?:@!?|@&|#)(\d{1,32})>/gu, "<\u200b$1>");
}

function validBoundary(index: number, protectedContent: readonly ProtectedRange[]): boolean {
  return !protectedContent.some((range) => range.start < index && index < range.end);
}

function candidates(content: string, pattern: RegExp, boundary: (match: RegExpExecArray) => number): number[] {
  const values: number[] = [];
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) values.push(boundary(match));
  return values;
}

function lastCandidate(
  values: readonly number[],
  start: number,
  maximumEnd: number,
  protectedContent: readonly ProtectedRange[],
): number | undefined {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value !== undefined && value > start && value <= maximumEnd && validBoundary(value, protectedContent)) return value;
  }
  return undefined;
}

function fallbackBoundary(
  content: string,
  start: number,
  maximumEnd: number,
  protectedContent: readonly ProtectedRange[],
): number {
  const crossing = protectedContent.find((range) => range.start < maximumEnd && maximumEnd < range.end);
  if (crossing) {
    if (crossing.start > start) return crossing.start;
    throw new Error("composition_schema_invalid");
  }
  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
  let boundary = start;
  for (const segment of segmenter.segment(content.slice(start, maximumEnd))) {
    const end = start + segment.index + segment.segment.length;
    if (end > maximumEnd) break;
    if (validBoundary(end, protectedContent)) boundary = end;
  }
  if (boundary <= start) throw new Error("composition_schema_invalid");
  return boundary;
}

function splitSemanticContentCore(content: string, maximum: number): string[] {
  if (content.length === 0) return [];
  if (content.length <= maximum) return [content];
  const protectedContent = protectedRanges(content, maximum);
  if (protectedContent.some((range) => range.end - range.start > maximum)) {
    throw new Error("composition_schema_invalid");
  }
  const boundaryGroups = [
    candidates(content, /\n(?=#\s)/gu, (match) => match.index + 1),
    candidates(content, /\n(?=#{2,6}\s)/gu, (match) => match.index + 1),
    candidates(content, /\n{2,}/gu, (match) => match.index + match[0].length),
    candidates(content, /\n(?=[-*+]\s|\d+[.)]\s)/gu, (match) => match.index + 1),
    candidates(content, /[.!?](?:["')\]]*)\s+/gu, (match) => match.index + match[0].length),
    candidates(content, /\s+/gu, (match) => match.index + match[0].length),
  ];
  const chunks: string[] = [];
  let start = 0;
  while (start < content.length) {
    const maximumEnd = Math.min(content.length, start + maximum);
    if (maximumEnd === content.length) {
      chunks.push(content.slice(start));
      break;
    }
    let end: number | undefined;
    for (const group of boundaryGroups) {
      end = lastCandidate(group, start, maximumEnd, protectedContent);
      if (end !== undefined) break;
    }
    end ??= fallbackBoundary(content, start, maximumEnd, protectedContent);
    chunks.push(content.slice(start, end));
    start = end;
  }
  if (chunks.join("") !== content || chunks.some((chunk) => chunk.length > maximum)) {
    throw new Error("composition_schema_invalid");
  }
  return chunks;
}

function fenceBodyBoundary(body: string, start: number, maximumEnd: number): number {
  const newline = body.lastIndexOf("\n", maximumEnd - 1);
  if (newline > start) return newline;
  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
  let boundary = start;
  for (const segment of segmenter.segment(body.slice(start, maximumEnd))) {
    const end = start + segment.index + segment.segment.length;
    if (end > maximumEnd) break;
    boundary = end;
  }
  if (boundary <= start) throw new Error("composition_schema_invalid");
  return boundary;
}

function splitLongFence(fence: string, maximum: number): string[] {
  const openingEnd = fence.indexOf("\n") + 1;
  const hasTrailingNewline = fence.endsWith("```\n");
  const closingStart = fence.lastIndexOf("```", fence.length - (hasTrailingNewline ? 2 : 1));
  if (openingEnd <= 0 || closingStart < openingEnd) throw new Error("composition_schema_invalid");
  const opening = fence.slice(0, openingEnd);
  const body = fence.slice(openingEnd, closingStart);
  const bodyMaximum = maximum - opening.length - 5;
  if (bodyMaximum < 1) throw new Error("composition_schema_invalid");
  const chunks: string[] = [];
  let start = 0;
  while (start < body.length) {
    const maximumEnd = Math.min(body.length, start + bodyMaximum);
    const end = maximumEnd === body.length ? body.length : fenceBodyBoundary(body, start, maximumEnd);
    const part = body.slice(start, end);
    const close = part.endsWith("\n") ? "```" : "\n```";
    const trailing = end === body.length && hasTrailingNewline ? "\n" : "";
    const chunk = `${opening}${part}${close}${trailing}`;
    if (chunk.length > maximum) throw new Error("composition_schema_invalid");
    chunks.push(chunk);
    start = end;
  }
  if (chunks.length === 0) throw new Error("composition_schema_invalid");
  return chunks;
}

function splitWithReopenedFences(content: string, maximum: number): string[] | undefined {
  fencedCodeBlock.lastIndex = 0;
  const longFences: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = fencedCodeBlock.exec(content)) !== null) {
    if (match[0].length > maximum) longFences.push(match);
  }
  if (longFences.length === 0) return undefined;
  const chunks: string[] = [];
  let cursor = 0;
  for (const fence of longFences) {
    chunks.push(...splitSemanticContentCore(content.slice(cursor, fence.index), maximum));
    chunks.push(...splitLongFence(fence[0], maximum));
    cursor = fence.index + fence[0].length;
  }
  chunks.push(...splitSemanticContentCore(content.slice(cursor), maximum));
  return chunks;
}

export function splitSemanticContent(content: string, maximum: number): string[] {
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error("composition_schema_invalid");
  const reopened = splitWithReopenedFences(content, maximum);
  return reopened ?? splitSemanticContentCore(content, maximum);
}

export function containsSplitProtectedLink(original: string, chunks: readonly string[]): boolean {
  const boundaries: number[] = [];
  let offset = 0;
  for (const chunk of chunks.slice(0, -1)) {
    offset += chunk.length;
    boundaries.push(offset);
  }
  return protectedRanges(original).some((range) => boundaries.some((boundary) => range.start < boundary && boundary < range.end));
}
