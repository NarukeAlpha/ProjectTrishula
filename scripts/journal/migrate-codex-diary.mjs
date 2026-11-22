#!/usr/bin/env node
/**
 * Idempotent migration script from the Codex Trading Diary into Project Trishula Convex.
 *
 * Requirements:
 *   - Node.js >= 24 (uses built-in node:sqlite, node:crypto, node:fs/promises, node:util, fetch)
 *   - Zero external npm dependencies
 *
 * Usage (dry-run by default):
 *   node scripts/journal/migrate-codex-diary.mjs \
 *     --export-json /path/to/diary-export.json \
 *     --charts-dir /Users/narukealpha/.codex/visualizations/2026/11/19/01a1f257-e656-7c02-bf12-93ad04c51633/tradingview-charts \
 *     --convex-site-url https://<deployment>.convex.site \
 *     --owner-id user_01...
 *
 *   # Or read directly from a local Codex D1 SQLite database:
 *   node scripts/journal/migrate-codex-diary.mjs \
 *     --sqlite /path/to/miniflare-d1.sqlite \
 *     --convex-site-url https://<deployment>.convex.site \
 *     --owner-id user_01...
 *
 *   # Execute writes (requires SERVICE_SHARED_SECRET in the environment):
 *   SERVICE_SHARED_SECRET=... node scripts/journal/migrate-codex-diary.mjs \
 *     --sqlite /path/to/miniflare-d1.sqlite \
 *     --convex-site-url https://<deployment>.convex.site \
 *     --owner-id user_01... \
 *     --apply
 */

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const DEFAULT_CHARTS_DIR =
  "/Users/narukealpha/.codex/visualizations/2026/11/19/01a1f257-e656-7c02-bf12-93ad04c51633/tradingview-charts";

const MIME_BY_EXT = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

function printUsage() {
  console.log(`Usage:
  node scripts/journal/migrate-codex-diary.mjs [options]

Options:
  --export-json <path>       Path to a Codex diary JSON export ({ trades, lessons, orderDays })
  --sqlite <path>            Path to a local Codex diary SQLite/D1 database
  --charts-dir <path>        Directory of chart images (default: ${DEFAULT_CHARTS_DIR})
  --convex-site-url <url>    Convex site base URL (or CONVEX_SITE_URL env var)
  --owner-id <workosUserId>  Target allowlisted WorkOS user ID (or JOURNAL_OWNER_ID env var)
  --apply                    Execute mutations against Convex (default: dry-run)
  -h, --help                 Show this help message

Environment:
  SERVICE_SHARED_SECRET      Required with --apply for Bearer auth against /internal/journal/*
  CONVEX_SITE_URL            Default for --convex-site-url
  JOURNAL_OWNER_ID           Default for --owner-id`);
}

function parseJsonMaybe(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    return JSON.parse(trimmed);
  }
  return value;
}

function normalizeTradeRow(raw) {
  const stableId = raw.stableId ?? raw.id;
  if (!stableId || typeof stableId !== "string") {
    throw new Error(`Trade row is missing id/stableId: ${JSON.stringify(raw).slice(0, 120)}`);
  }
  const mistakes = parseJsonMaybe(raw.mistakes, []);
  const assistantReview = raw.assistantReview ?? raw.assistant_review ?? null;

  return {
    stableId,
    trade: {
      symbol: String(raw.symbol ?? "").trim().toUpperCase(),
      instrument: raw.instrument,
      account: raw.account,
      direction: raw.direction ?? "",
      status: raw.status,
      openedOn: raw.openedOn ?? raw.opened_on ?? "",
      closedOn: raw.closedOn ?? raw.closed_on ?? null,
      setup: raw.setup ?? "",
      size: raw.size ?? "",
      details: raw.details ?? "",
      plannedRiskCents: raw.plannedRiskCents ?? raw.planned_risk_cents ?? null,
      realizedPnlCents: raw.realizedPnlCents ?? raw.realized_pnl_cents ?? null,
      thesis: raw.thesis ?? "",
      plan: raw.plan ?? "",
      review: raw.review ?? "",
      adherence: raw.adherence ?? "Unreviewed",
      mistakes: Array.isArray(mistakes) ? mistakes : [],
    },
    assistantReview: assistantReview === undefined ? null : assistantReview,
  };
}

function normalizeOrderBatchRow(raw) {
  const stableId = raw.stableId ?? raw.id;
  if (!stableId || typeof stableId !== "string") {
    throw new Error(`Order batch row is missing id/stableId: ${JSON.stringify(raw).slice(0, 120)}`);
  }
  const orders = parseJsonMaybe(raw.orders, []);
  return {
    stableId,
    date: raw.date,
    note: raw.note ?? "",
    orders: Array.isArray(orders) ? orders : [],
  };
}

function normalizeLessonRow(raw) {
  const stableId = raw.stableId ?? raw.id;
  if (!stableId || typeof stableId !== "string") {
    throw new Error(`Lesson row is missing id/stableId: ${JSON.stringify(raw).slice(0, 120)}`);
  }
  return {
    stableId,
    lesson: {
      title: raw.title ?? "",
      body: raw.body ?? "",
      tradeStableId: raw.tradeStableId ?? raw.tradeId ?? raw.trade_id ?? null,
    },
  };
}

function loadFromSqlite(sqlitePath) {
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => String(row.name)),
    );

    const tradesById = new Map();
    if (tables.has("trades")) {
      for (const row of db.prepare("SELECT * FROM trades").all()) {
        const normalized = normalizeTradeRow(row);
        tradesById.set(normalized.stableId, normalized);
      }
    }

    const orderDays = [];
    if (tables.has("order_imports")) {
      for (const row of db.prepare("SELECT * FROM order_imports").all()) {
        orderDays.push(normalizeOrderBatchRow(row));
        const pendingTrades = parseJsonMaybe(row.pending_trades, []);
        if (Array.isArray(pendingTrades)) {
          for (const pending of pendingTrades) {
            const normalized = normalizeTradeRow(pending);
            if (!tradesById.has(normalized.stableId)) {
              tradesById.set(normalized.stableId, normalized);
            }
          }
        }
      }
    }

    const lessons = [];
    if (tables.has("lessons")) {
      for (const row of db.prepare("SELECT * FROM lessons").all()) {
        lessons.push(normalizeLessonRow(row));
      }
    }

    return {
      trades: [...tradesById.values()],
      orderDays,
      lessons,
    };
  } finally {
    db.close();
  }
}

async function loadFromExportJson(jsonPath) {
  const raw = JSON.parse(await readFile(jsonPath, "utf8"));
  const rawTrades = Array.isArray(raw.trades) ? raw.trades : [];
  const rawOrders = Array.isArray(raw.orderDays)
    ? raw.orderDays
    : Array.isArray(raw.orderBatches)
      ? raw.orderBatches
      : Array.isArray(raw.order_imports)
        ? raw.order_imports
        : [];
  const rawLessons = Array.isArray(raw.lessons) ? raw.lessons : [];

  const tradesById = new Map();
  for (const row of rawTrades) {
    const normalized = normalizeTradeRow(row);
    tradesById.set(normalized.stableId, normalized);
  }
  const orderDays = [];
  for (const row of rawOrders) {
    orderDays.push(normalizeOrderBatchRow(row));
    const pendingTrades = parseJsonMaybe(row.pendingTrades ?? row.pending_trades, []);
    if (Array.isArray(pendingTrades)) {
      for (const pending of pendingTrades) {
        const normalized = normalizeTradeRow(pending);
        if (!tradesById.has(normalized.stableId)) {
          tradesById.set(normalized.stableId, normalized);
        }
      }
    }
  }
  const lessons = rawLessons.map(normalizeLessonRow);

  return {
    trades: [...tradesById.values()],
    orderDays,
    lessons,
  };
}

function inferChartMetadata(filename) {
  const base = path.parse(filename).name;
  const parts = base.split("-");
  const symbol = parts[0] && /^[A-Z0-9.]{1,12}$/i.test(parts[0]) ? parts[0].toUpperCase() : undefined;
  const last = parts.at(-1);
  const interval = last && /^\d+[mhdw]$/i.test(last) ? last.toLowerCase() : undefined;
  return { symbol, interval };
}

async function scanChartsDir(chartsDir) {
  try {
    const info = await stat(chartsDir);
    if (!info.isDirectory()) return [];
  } catch {
    return [];
  }

  const entries = await readdir(chartsDir, { withFileTypes: true });
  const charts = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    const mimeType = MIME_BY_EXT.get(ext);
    if (!mimeType) continue;
    const filePath = path.join(chartsDir, entry.name);
    const bytes = await readFile(filePath);
    const imageKey = createHash("sha256").update(bytes).digest("hex");
    const { symbol, interval } = inferChartMetadata(entry.name);
    charts.push({
      filename: entry.name,
      filePath,
      mimeType,
      bytes,
      imageKey,
      symbol,
      interval,
    });
  }
  charts.sort((a, b) => a.filename.localeCompare(b.filename));
  return charts;
}

function collectReferencedChartKeys(trades) {
  const keys = new Set();
  for (const entry of trades) {
    if (!entry.assistantReview) continue;
    let parsed = null;
    if (typeof entry.assistantReview === "string") {
      if (!entry.assistantReview.trimStart().startsWith("{")) continue;
      try {
        parsed = JSON.parse(entry.assistantReview);
      } catch {
        continue;
      }
    } else if (typeof entry.assistantReview === "object") {
      parsed = entry.assistantReview;
    }
    if (parsed && Array.isArray(parsed.charts)) {
      for (const chart of parsed.charts) {
        if (chart && typeof chart.image === "string") {
          keys.add(chart.image);
        }
      }
    }
  }
  return keys;
}

async function postJournalApi(baseUrl, secret, routePath, payload) {
  const url = `${baseUrl.replace(/\/+$/, "")}${routePath}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    throw new Error(`POST ${routePath} failed (${response.status}): ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

async function main() {
  const { values } = parseArgs({
    options: {
      "export-json": { type: "string" },
      sqlite: { type: "string" },
      "charts-dir": { type: "string", default: DEFAULT_CHARTS_DIR },
      "convex-site-url": { type: "string" },
      "owner-id": { type: "string" },
      apply: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  if (values.help) {
    printUsage();
    return;
  }

  const exportJsonPath = values["export-json"];
  const sqlitePath = values.sqlite;
  if (!exportJsonPath && !sqlitePath) {
    console.error("Error: Provide either --export-json <path> or --sqlite <path>.");
    printUsage();
    process.exitCode = 1;
    return;
  }
  if (exportJsonPath && sqlitePath) {
    console.error("Error: Specify only one of --export-json or --sqlite.");
    process.exitCode = 1;
    return;
  }

  const convexSiteUrl = values["convex-site-url"] ?? process.env.CONVEX_SITE_URL ?? "";
  const ownerId = values["owner-id"] ?? process.env.JOURNAL_OWNER_ID ?? process.env.MARKET_RESEARCH_OWNER_ID ?? "";
  const chartsDir = values["charts-dir"] ?? DEFAULT_CHARTS_DIR;
  const apply = Boolean(values.apply);

  if (apply) {
    if (!convexSiteUrl.trim()) {
      throw new Error("--convex-site-url (or CONVEX_SITE_URL) is required with --apply.");
    }
    if (!ownerId.trim()) {
      throw new Error("--owner-id (or JOURNAL_OWNER_ID) is required with --apply.");
    }
    if (!process.env.SERVICE_SHARED_SECRET?.trim()) {
      throw new Error("SERVICE_SHARED_SECRET environment variable is required with --apply.");
    }
  }

  const data = exportJsonPath
    ? await loadFromExportJson(exportJsonPath)
    : loadFromSqlite(sqlitePath);
  const charts = await scanChartsDir(chartsDir);
  const reviewsToSave = data.trades.filter((entry) => entry.assistantReview !== null);
  const referencedKeys = collectReferencedChartKeys(data.trades);
  const localChartKeys = new Set(charts.map((chart) => chart.imageKey));
  const missingChartKeys = [...referencedKeys].filter((key) => !localChartKeys.has(key));

  console.log(`Mode:            ${apply ? "APPLY (live writes)" : "DRY-RUN (no writes)"}`);
  console.log(`Source:          ${exportJsonPath ?? sqlitePath}`);
  console.log(`Charts dir:      ${chartsDir}`);
  console.log(`Convex site URL: ${convexSiteUrl || "(not set)"}`);
  console.log(`Owner ID:        ${ownerId || "(not set)"}`);
  console.log(`Summary:`);
  console.log(`  Charts:        ${charts.length}`);
  console.log(`  Order batches: ${data.orderDays.length}`);
  console.log(`  Trades:        ${data.trades.length}`);
  console.log(`  Reviews:       ${reviewsToSave.length}`);
  console.log(`  Lessons:       ${data.lessons.length}`);

  if (missingChartKeys.length > 0) {
    console.warn(
      `Warning: ${missingChartKeys.length} chart image key(s) referenced in structured reviews were not found in ${chartsDir}:`,
    );
    for (const key of missingChartKeys) {
      console.warn(`  - ${key}`);
    }
  }

  if (!apply) {
    console.log("\nDry-run complete. Re-run with --apply and SERVICE_SHARED_SECRET to migrate.");
    return;
  }

  const secret = process.env.SERVICE_SHARED_SECRET.trim();

  // 1. Upload charts (deduplicated by ownerId + imageKey on the server)
  for (const chart of charts) {
    const payload = {
      ownerId,
      base64Data: chart.bytes.toString("base64"),
      mimeType: chart.mimeType,
      source: "migration",
      ...(chart.symbol ? { symbol: chart.symbol } : {}),
      ...(chart.interval ? { interval: chart.interval } : {}),
    };
    const uploaded = await postJournalApi(
      convexSiteUrl,
      secret,
      "/internal/journal/tools/upload-chart",
      payload,
    );
    console.log(`Uploaded chart ${chart.filename} -> ${uploaded.imageKey}`);
  }

  // 2. Import order batches and trades (without clobbering reviews)
  if (data.orderDays.length > 0 || data.trades.length > 0) {
    const imported = await postJournalApi(
      convexSiteUrl,
      secret,
      "/internal/journal/tools/import-orders",
      {
        ownerId,
        orderDays: data.orderDays,
        trades: data.trades.map(({ stableId, trade }) => ({ stableId, trade })),
      },
    );
    console.log(
      `Imported ${imported.orderDays.length} order batch(es) and ${imported.trades.length} trade(s).`,
    );
  }

  // 3. Save structured or plain assistant reviews after charts and trades exist
  for (const entry of reviewsToSave) {
    await postJournalApi(
      convexSiteUrl,
      secret,
      "/internal/journal/tools/save-review",
      {
        ownerId,
        tradeStableId: entry.stableId,
        assistantReview: entry.assistantReview,
      },
    );
    console.log(`Saved assistant review for trade ${entry.stableId} (${entry.trade.symbol}).`);
  }

  // 4. Upsert lessons (after trades exist so tradeStableId ownership checks pass)
  for (const entry of data.lessons) {
    await postJournalApi(
      convexSiteUrl,
      secret,
      "/internal/journal/tools/upsert-lesson",
      {
        ownerId,
        stableId: entry.stableId,
        lesson: entry.lesson,
      },
    );
    console.log(`Upserted lesson ${entry.stableId} (${entry.lesson.title}).`);
  }

  console.log("\nMigration complete.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
