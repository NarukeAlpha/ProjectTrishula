import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";

const expectedWidth = 1586;
const expectedHeight = 992;

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function paeth(left, up, upLeft) {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

function parsePng(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (!buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error(`${filePath} is not a PNG`);
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  if (bitDepth !== 8) {
    throw new Error(`${filePath} uses unsupported PNG bit depth ${bitDepth}`);
  }

  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) {
    throw new Error(`${filePath} uses unsupported PNG color type ${colorType}`);
  }

  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const raw = Buffer.alloc(height * stride);
  let sourceOffset = 0;

  for (let row = 0; row < height; row += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const rowOffset = row * stride;
    for (let col = 0; col < stride; col += 1) {
      const value = inflated[sourceOffset + col];
      const left = col >= channels ? raw[rowOffset + col - channels] : 0;
      const up = row > 0 ? raw[rowOffset + col - stride] : 0;
      const upLeft = row > 0 && col >= channels ? raw[rowOffset + col - stride - channels] : 0;
      let resolved = value;
      if (filter === 1) resolved = value + left;
      else if (filter === 2) resolved = value + up;
      else if (filter === 3) resolved = value + Math.floor((left + up) / 2);
      else if (filter === 4) resolved = value + paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`${filePath} uses unsupported PNG filter ${filter}`);
      raw[rowOffset + col] = resolved & 0xff;
    }
    sourceOffset += stride;
  }

  return { filePath, width, height, channels, colorType, raw };
}

function rgbAt(image, x, y) {
  const offset = (y * image.width + x) * image.channels;
  if (image.colorType === 0) {
    const value = image.raw[offset];
    return [value, value, value];
  }
  return [image.raw[offset], image.raw[offset + 1], image.raw[offset + 2]];
}

function regionStats(image, region) {
  const x0 = Math.max(0, Math.floor(region.x0));
  const y0 = Math.max(0, Math.floor(region.y0));
  const x1 = Math.min(image.width, Math.ceil(region.x1));
  const y1 = Math.min(image.height, Math.ceil(region.y1));
  let count = 0;
  let lumSum = 0;
  let lumSq = 0;
  let colorful = 0;
  let bright = 0;
  const step = 4;

  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const [r, g, b] = rgbAt(image, x, y);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lumSum += lum;
      lumSq += lum * lum;
      count += 1;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 24) colorful += 1;
      if (lum > 42) bright += 1;
    }
  }

  const mean = lumSum / count;
  const variance = Math.max(0, lumSq / count - mean * mean);
  return {
    mean: Number(mean.toFixed(2)),
    standardDeviation: Number(Math.sqrt(variance).toFixed(2)),
    colorfulRatio: Number((colorful / count).toFixed(4)),
    brightRatio: Number((bright / count).toFixed(4)),
  };
}

const regions = [
  ["topAppBar", { x0: 0, y0: 0, x1: 1586, y1: 84 }],
  ["leftRail", { x0: 0, y0: 84, x1: 266, y1: 992 }],
  ["marketWorkspace", { x0: 266, y0: 84, x1: 1258, y1: 600 }],
  ["rightPanel", { x0: 1258, y0: 84, x1: 1586, y1: 950 }],
  ["bottomDock", { x0: 266, y0: 600, x1: 1258, y1: 950 }],
];

function verifyImage(label, filePath) {
  const image = parsePng(filePath);
  const regionResults = Object.fromEntries(
    regions.map(([name, region]) => [name, regionStats(image, region)])
  );
  const failures = [];
  if (image.width !== expectedWidth || image.height !== expectedHeight) {
    failures.push(`expected ${expectedWidth}x${expectedHeight}, got ${image.width}x${image.height}`);
  }
  for (const [name, stats] of Object.entries(regionResults)) {
    if (stats.standardDeviation < 4) failures.push(`${name} is visually too flat`);
    if (stats.brightRatio < 0.01) failures.push(`${name} has too little visible foreground`);
  }
  if (regionResults.marketWorkspace.colorfulRatio < 0.025) {
    failures.push("marketWorkspace lacks enough colored chart/level pixels");
  }
  if (regionResults.bottomDock.colorfulRatio < 0.01) {
    failures.push("bottomDock lacks enough tab/table color variation");
  }

  return {
    label,
    filePath,
    width: image.width,
    height: image.height,
    regionResults,
    failures,
    isApproved: failures.length === 0,
  };
}

const electronPath = readArg("--electron");
const outputPath = readArg("--output");
if (!electronPath) {
  console.error("Usage: node scripts/verify-snapshots.mjs --electron <png> [--output <json>]");
  process.exit(2);
}

const electron = verifyImage("electron", electronPath);

const trace = {
  verifier: "frontend-snapshot-content",
  isApproved: electron.isApproved,
  electron,
};

if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(trace, null, 2)}\n`);
}

if (!trace.isApproved) {
  console.error(JSON.stringify(trace, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  verifier: trace.verifier,
  isApproved: trace.isApproved,
  electron: { width: electron.width, height: electron.height },
}));
