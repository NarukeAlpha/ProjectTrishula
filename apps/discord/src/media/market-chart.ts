import { deflateSync } from "node:zlib";
import { z } from "zod";

export const MAX_MARKET_CHART_POINTS = 240;
export const MAX_DISCORD_GENERATED_FILE_BYTES = 8 * 1_024 * 1_024;
const CHART_WIDTH = 960;
const CHART_HEIGHT = 540;

const marketChartPointSchema = z
  .object({
    timestamp: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    close: z
      .number()
      .nonnegative()
      .refine(Number.isFinite, "Finite close required."),
  })
  .strict();

export const marketChartSpecSchema = z
  .object({
    symbol: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .regex(/^[A-Za-z0-9.^=-]+$/),
    title: z.string().trim().min(1).max(64).optional(),
    points: z
      .array(marketChartPointSchema)
      .min(2)
      .max(MAX_MARKET_CHART_POINTS),
  })
  .strict()
  .superRefine((chart, context) => {
    for (let index = 1; index < chart.points.length; index += 1) {
      const previous = chart.points[index - 1];
      const current = chart.points[index];
      if (
        previous !== undefined &&
        current !== undefined &&
        current.timestamp <= previous.timestamp
      ) {
        context.addIssue({
          code: "custom",
          path: ["points", index, "timestamp"],
          message: "Chart timestamps must increase.",
        });
      }
    }
  });

export type MarketChartSpec = z.infer<typeof marketChartSpecSchema>;

export interface RenderedMarketChart {
  attachment: Buffer;
  name: string;
  description: string;
  contentType: "image/png";
}

type Color = readonly [red: number, green: number, blue: number, alpha: number];

const COLORS = {
  background: [12, 17, 29, 255],
  panel: [17, 24, 39, 255],
  grid: [48, 62, 82, 255],
  text: [216, 226, 240, 255],
  muted: [126, 145, 169, 255],
  positive: [79, 197, 255, 255],
  negative: [255, 102, 153, 255],
} as const satisfies Record<string, Color>;

const FONT = {
  " ": ["000", "000", "000", "000", "000", "000", "000"],
  "?": ["111", "001", "001", "010", "010", "000", "010"],
  ".": ["000", "000", "000", "000", "000", "000", "010"],
  ":": ["000", "010", "000", "000", "010", "000", "000"],
  "+": ["000", "010", "010", "111", "010", "010", "000"],
  "-": ["000", "000", "000", "111", "000", "000", "000"],
  "%": ["101", "001", "010", "010", "100", "101", "000"],
  "/": ["001", "001", "010", "010", "100", "100", "000"],
  "=": ["000", "111", "000", "111", "000", "000", "000"],
  ">": ["100", "010", "001", "010", "100", "000", "000"],
  "0": ["111", "101", "101", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "010", "010", "111"],
  "2": ["111", "001", "001", "111", "100", "100", "111"],
  "3": ["111", "001", "001", "111", "001", "001", "111"],
  "4": ["101", "101", "101", "111", "001", "001", "001"],
  "5": ["111", "100", "100", "111", "001", "001", "111"],
  "6": ["111", "100", "100", "111", "101", "101", "111"],
  "7": ["111", "001", "001", "010", "010", "010", "010"],
  "8": ["111", "101", "101", "111", "101", "101", "111"],
  "9": ["111", "101", "101", "111", "001", "001", "111"],
  A: ["010", "101", "101", "111", "101", "101", "101"],
  B: ["110", "101", "101", "110", "101", "101", "110"],
  C: ["111", "100", "100", "100", "100", "100", "111"],
  D: ["110", "101", "101", "101", "101", "101", "110"],
  E: ["111", "100", "100", "110", "100", "100", "111"],
  F: ["111", "100", "100", "110", "100", "100", "100"],
  G: ["111", "100", "100", "101", "101", "101", "111"],
  H: ["101", "101", "101", "111", "101", "101", "101"],
  I: ["111", "010", "010", "010", "010", "010", "111"],
  J: ["001", "001", "001", "001", "101", "101", "111"],
  K: ["101", "101", "110", "100", "110", "101", "101"],
  L: ["100", "100", "100", "100", "100", "100", "111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["1001", "1101", "1101", "1011", "1011", "1001", "1001"],
  O: ["111", "101", "101", "101", "101", "101", "111"],
  P: ["110", "101", "101", "110", "100", "100", "100"],
  Q: ["111", "101", "101", "101", "101", "111", "001"],
  R: ["110", "101", "101", "110", "110", "101", "101"],
  S: ["111", "100", "100", "111", "001", "001", "111"],
  T: ["111", "010", "010", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "101", "101", "111"],
  V: ["101", "101", "101", "101", "101", "101", "010"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["101", "101", "101", "010", "101", "101", "101"],
  Y: ["101", "101", "101", "010", "010", "010", "010"],
  Z: ["111", "001", "001", "010", "100", "100", "111"],
} as const satisfies Readonly<Record<string, readonly string[]>>;
const FONT_BY_CHARACTER = new Map(Object.entries(FONT));

function safeLabel(value: string, limit: number): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9 .:+\-/%=>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function setPixel(
  pixels: Buffer,
  x: number,
  y: number,
  color: Color,
): void {
  if (x < 0 || y < 0 || x >= CHART_WIDTH || y >= CHART_HEIGHT) return;
  const offset = (y * CHART_WIDTH + x) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3];
}

function fillRect(
  pixels: Buffer,
  left: number,
  top: number,
  width: number,
  height: number,
  color: Color,
): void {
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) setPixel(pixels, x, y, color);
  }
}

function drawLine(
  pixels: Buffer,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  color: Color,
): void {
  let x = Math.round(fromX);
  let y = Math.round(fromY);
  const endX = Math.round(toX);
  const endY = Math.round(toY);
  const deltaX = Math.abs(endX - x);
  const stepX = x < endX ? 1 : -1;
  const deltaY = -Math.abs(endY - y);
  const stepY = y < endY ? 1 : -1;
  let error = deltaX + deltaY;
  while (true) {
    setPixel(pixels, x, y, color);
    setPixel(pixels, x, y + 1, color);
    if (x === endX && y === endY) return;
    const twice = 2 * error;
    if (twice >= deltaY) {
      error += deltaY;
      x += stepX;
    }
    if (twice <= deltaX) {
      error += deltaX;
      y += stepY;
    }
  }
}

function drawText(
  pixels: Buffer,
  value: string,
  left: number,
  top: number,
  scale: number,
  color: Color,
): void {
  let cursor = left;
  const fallback = FONT["?"] ?? [];
  for (const character of safeLabel(value, 72)) {
    const glyph = FONT_BY_CHARACTER.get(character) ?? fallback;
    const glyphWidth = glyph[0]?.length ?? 3;
    for (let row = 0; row < glyph.length; row += 1) {
      const pattern = glyph[row] ?? "";
      for (let column = 0; column < pattern.length; column += 1) {
        if (pattern[column] !== "1") continue;
        fillRect(
          pixels,
          cursor + column * scale,
          top + row * scale,
          scale,
          scale,
          color,
        );
      }
    }
    cursor += (glyphWidth + 1) * scale;
  }
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  typeBytes.copy(header, 4);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([header, data, checksum]);
}

function encodePng(pixels: Buffer, title: string): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(CHART_WIDTH, 0);
  header.writeUInt32BE(CHART_HEIGHT, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = CHART_WIDTH * 4;
  const scanlines = Buffer.alloc((stride + 1) * CHART_HEIGHT);
  for (let y = 0; y < CHART_HEIGHT; y += 1) {
    const target = y * (stride + 1);
    scanlines[target] = 0;
    pixels.copy(scanlines, target + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("tEXt", Buffer.from(`Title\0${title}`, "latin1")),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function formatClose(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 10_000) return value.toFixed(0);
  if (absolute >= 100) return value.toFixed(1);
  return value.toFixed(2);
}

export function renderMarketChart(input: MarketChartSpec): RenderedMarketChart {
  const chart = marketChartSpecSchema.parse(input);
  const pixels = Buffer.alloc(CHART_WIDTH * CHART_HEIGHT * 4);
  fillRect(pixels, 0, 0, CHART_WIDTH, CHART_HEIGHT, COLORS.background);
  fillRect(pixels, 28, 28, CHART_WIDTH - 56, CHART_HEIGHT - 56, COLORS.panel);

  const first = chart.points[0];
  const last = chart.points.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error("A market chart requires at least two points.");
  }
  const closes = chart.points.map((point) => point.close);
  const low = Math.min(...closes);
  const high = Math.max(...closes);
  const baseRange = high - low;
  const padding = baseRange === 0 ? Math.max(Math.abs(high) * 0.02, 1) : baseRange * 0.08;
  const minimum = low - padding;
  const maximum = high + padding;
  const range = maximum - minimum;

  const plotLeft = 70;
  const plotRight = CHART_WIDTH - 44;
  const plotTop = 116;
  const plotBottom = CHART_HEIGHT - 72;
  for (let grid = 0; grid <= 5; grid += 1) {
    const horizontalY = Math.round(plotTop + ((plotBottom - plotTop) * grid) / 5);
    drawLine(pixels, plotLeft, horizontalY, plotRight, horizontalY, COLORS.grid);
    const verticalX = Math.round(plotLeft + ((plotRight - plotLeft) * grid) / 5);
    drawLine(pixels, verticalX, plotTop, verticalX, plotBottom, COLORS.grid);
  }

  const timeRange = last.timestamp - first.timestamp;
  const lineColor = last.close >= first.close ? COLORS.positive : COLORS.negative;
  const coordinates = chart.points.map((point, index) => ({
    x:
      timeRange === 0
        ? plotLeft + ((plotRight - plotLeft) * index) / (chart.points.length - 1)
        : plotLeft + ((point.timestamp - first.timestamp) / timeRange) * (plotRight - plotLeft),
    y: plotBottom - ((point.close - minimum) / range) * (plotBottom - plotTop),
  }));
  for (let index = 1; index < coordinates.length; index += 1) {
    const previous = coordinates[index - 1];
    const current = coordinates[index];
    if (previous !== undefined && current !== undefined) {
      drawLine(pixels, previous.x, previous.y, current.x, current.y, lineColor);
    }
  }

  const changePercent = first.close === 0
    ? 0
    : ((last.close - first.close) / Math.abs(first.close)) * 100;
  const change = `${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%`;
  const symbol = safeLabel(chart.symbol, 20);
  const title = safeLabel(chart.title ?? `${symbol} MARKET CHART`, 64);
  drawText(pixels, title, 70, 52, 3, COLORS.text);
  drawText(pixels, `${symbol} ${change}`, 70, 86, 2, lineColor);
  drawText(pixels, formatClose(maximum), plotRight - 94, plotTop - 22, 2, COLORS.muted);
  drawText(pixels, formatClose(minimum), plotRight - 94, plotBottom + 12, 2, COLORS.muted);
  drawText(
    pixels,
    `${formatClose(first.close)} > ${formatClose(last.close)}`,
    plotLeft,
    plotBottom + 26,
    2,
    COLORS.muted,
  );

  const attachment = encodePng(pixels, title || symbol);
  if (attachment.length > MAX_DISCORD_GENERATED_FILE_BYTES) {
    throw new Error("The generated market chart exceeded the Discord file limit.");
  }
  const safeFilenameSymbol = chart.symbol
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 32);
  return {
    attachment,
    name: `${safeFilenameSymbol || "market"}-chart.png`,
    description: `${symbol || "Market"} close-price chart`,
    contentType: "image/png",
  };
}
