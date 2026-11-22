export interface ReviewRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReviewChartLevel {
  y: number;
  label: string;
}

export interface ReviewChartTick {
  x: number;
  label: string;
}

export interface ReviewChart {
  image: string;
  width: number;
  height: number;
  crop: ReviewRectangle;
  focus: ReviewRectangle;
  focusLabel: string;
  levels: ReviewChartLevel[];
  ticks: ReviewChartTick[];
  interval: string;
  heading: string;
  text: string;
  alt: string;
}

export interface ChartReview {
  version: 1;
  instrument: string;
  timeZone: string;
  timing?: string;
  summary: string;
  charts: ReviewChart[];
  nextTime: string;
  note?: string;
}

type JsonPrimitive = string | number | boolean | null;
type JsonObject = { [key: string]: JsonValue };
type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;

const CHART_IMAGE_ID_PATTERN = /^[0-9a-f]{64}$/;
const MAX_DIMENSION = 16_000;

const ROOT_KEYS = new Set([
  "version",
  "instrument",
  "timeZone",
  "timing",
  "summary",
  "charts",
  "nextTime",
  "note",
]);

const CHART_KEYS = new Set([
  "image",
  "width",
  "height",
  "crop",
  "focus",
  "focusLabel",
  "levels",
  "ticks",
  "interval",
  "heading",
  "text",
  "alt",
]);

const RECT_KEYS = new Set(["x", "y", "width", "height"]);
const LEVEL_KEYS = new Set(["y", "label"]);
const TICK_KEYS = new Set(["x", "label"]);

function isJsonRecord(value: JsonValue | undefined): value is JsonObject {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isJsonString(value: JsonValue | undefined): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}

function hasOnlyAllowedKeys(
  record: JsonObject,
  allowedKeys: ReadonlySet<string>,
): boolean {
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) return false;
  }
  return true;
}

function readTrimmedString(
  value: JsonValue | undefined,
  minLength: number,
  maxLength: number,
): string | null {
  if (!isJsonString(value)) return null;
  const trimmed = value.trim();
  if (trimmed.length < minLength || trimmed.length > maxLength) return null;
  return trimmed;
}

function readBoundedInt(
  value: JsonValue | undefined,
  min: number,
  max: number,
): number | null {
  if (Object.prototype.toString.call(value) !== "[object Number]") return null;
  // SAFETY: Object.prototype.toString verified value is a number primitive.
  const numeric = value as number;
  if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
    return null;
  }
  return numeric;
}

function readRectangle(value: JsonValue | undefined): ReviewRectangle | null {
  if (!isJsonRecord(value) || !hasOnlyAllowedKeys(value, RECT_KEYS)) {
    return null;
  }
  const x = readBoundedInt(value.x, 0, MAX_DIMENSION);
  const y = readBoundedInt(value.y, 0, MAX_DIMENSION);
  const width = readBoundedInt(value.width, 1, MAX_DIMENSION);
  const height = readBoundedInt(value.height, 1, MAX_DIMENSION);
  if (x === null || y === null || width === null || height === null) {
    return null;
  }
  return { x, y, width, height };
}

function contains(outer: ReviewRectangle, inner: ReviewRectangle): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function readLevel(value: JsonValue | undefined): ReviewChartLevel | null {
  if (!isJsonRecord(value) || !hasOnlyAllowedKeys(value, LEVEL_KEYS)) {
    return null;
  }
  const y = readBoundedInt(value.y, 0, MAX_DIMENSION);
  const label = readTrimmedString(value.label, 1, 14);
  if (y === null || label === null) return null;
  return { y, label };
}

function readTick(value: JsonValue | undefined): ReviewChartTick | null {
  if (!isJsonRecord(value) || !hasOnlyAllowedKeys(value, TICK_KEYS)) {
    return null;
  }
  const x = readBoundedInt(value.x, 0, MAX_DIMENSION);
  const label = readTrimmedString(value.label, 1, 12);
  if (x === null || label === null) return null;
  return { x, label };
}

function readReviewChart(value: JsonValue | undefined): ReviewChart | null {
  if (!isJsonRecord(value) || !hasOnlyAllowedKeys(value, CHART_KEYS)) {
    return null;
  }
  const image = isJsonString(value.image) ? value.image : null;
  if (image === null || !CHART_IMAGE_ID_PATTERN.test(image)) return null;

  const width = readBoundedInt(value.width, 1, MAX_DIMENSION);
  const height = readBoundedInt(value.height, 1, MAX_DIMENSION);
  const crop = readRectangle(value.crop);
  const focus = readRectangle(value.focus);
  const focusLabel = readTrimmedString(value.focusLabel, 1, 100);
  const interval = readTrimmedString(value.interval, 1, 100);
  const heading = readTrimmedString(value.heading, 1, 100);
  const text = readTrimmedString(value.text, 1, 750);
  const alt = readTrimmedString(value.alt, 1, 750);

  if (
    width === null ||
    height === null ||
    crop === null ||
    focus === null ||
    focusLabel === null ||
    interval === null ||
    heading === null ||
    text === null ||
    alt === null
  ) {
    return null;
  }

  if (!Array.isArray(value.levels) || value.levels.length > 3) return null;
  const levels: ReviewChartLevel[] = [];
  for (const item of value.levels) {
    const level = readLevel(item);
    if (level === null) return null;
    levels.push(level);
  }

  if (
    !Array.isArray(value.ticks) ||
    value.ticks.length < 1 ||
    value.ticks.length > 5
  ) {
    return null;
  }
  const ticks: ReviewChartTick[] = [];
  for (const item of value.ticks) {
    const tick = readTick(item);
    if (tick === null) return null;
    ticks.push(tick);
  }

  const imageBounds: ReviewRectangle = { x: 0, y: 0, width, height };
  if (
    !contains(imageBounds, crop) ||
    !contains(crop, focus) ||
    !levels.every(({ y }) => y >= crop.y && y <= crop.y + crop.height) ||
    !ticks.every(({ x }) => x >= crop.x && x <= crop.x + crop.width)
  ) {
    return null;
  }

  return {
    image,
    width,
    height,
    crop,
    focus,
    focusLabel,
    levels,
    ticks,
    interval,
    heading,
    text,
    alt,
  };
}

export function readChartReview(stored: string | null): ChartReview | null {
  if (!stored?.trimStart().startsWith("{")) return null;
  let parsed: JsonValue;
  try {
    // SAFETY: JSON.parse returns a valid JSON value tree or throws SyntaxError; all fields are validated below.
    parsed = JSON.parse(stored) as JsonValue;
  } catch {
    return null;
  }
  if (!isJsonRecord(parsed) || !hasOnlyAllowedKeys(parsed, ROOT_KEYS)) {
    return null;
  }
  if (parsed.version !== 1) return null;

  const instrument = readTrimmedString(parsed.instrument, 1, 100);
  const timeZone = readTrimmedString(parsed.timeZone, 1, 12);
  const summary = readTrimmedString(parsed.summary, 1, 750);
  const nextTime = readTrimmedString(parsed.nextTime, 1, 750);
  if (
    instrument === null ||
    timeZone === null ||
    summary === null ||
    nextTime === null
  ) {
    return null;
  }

  let timing: string | undefined;
  if (parsed.timing !== undefined) {
    const validatedTiming = readTrimmedString(parsed.timing, 1, 100);
    if (validatedTiming === null) return null;
    timing = validatedTiming;
  }

  let note: string | undefined;
  if (parsed.note !== undefined) {
    const validatedNote = readTrimmedString(parsed.note, 1, 750);
    if (validatedNote === null) return null;
    note = validatedNote;
  }

  if (
    !Array.isArray(parsed.charts) ||
    parsed.charts.length < 1 ||
    parsed.charts.length > 8
  ) {
    return null;
  }

  const charts: ReviewChart[] = [];
  for (const item of parsed.charts) {
    const chart = readReviewChart(item);
    if (chart === null) return null;
    charts.push(chart);
  }

  const review: ChartReview = {
    version: 1,
    instrument,
    timeZone,
    summary,
    charts,
    nextTime,
  };
  if (timing !== undefined) review.timing = timing;
  if (note !== undefined) review.note = note;
  return review;
}
