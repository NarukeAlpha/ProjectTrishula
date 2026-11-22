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
 *     --source-owner user-or-email \
 *     --convex-site-url https://<deployment>.convex.site \
 *     --owner-id user_01...
 *
 *   # Execute writes (requires JOURNAL_ADMIN_SECRET or SERVICE_SHARED_SECRET in the environment):
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

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

function printUsage() {
  console.log(`Usage:
  node scripts/journal/migrate-codex-diary.mjs [options]

Options:
  --export-json <path>           Path to a Codex diary JSON export ({ trades, lessons, orderDays })
  --sqlite <path>                Path to a local Codex diary SQLite/D1 database
  --source-owner <email-or-id>   Source owner filter for SQLite DBs (required if >1 owner exists)
  --charts-dir <path>            Directory of chart images (default: ${DEFAULT_CHARTS_DIR})
  --convex-site-url <url>        Convex site base URL (or CONVEX_SITE_URL env var)
  --owner-id <workosUserId>      Target allowlisted WorkOS user ID (or JOURNAL_OWNER_ID env var)
  --replace-reviews              Allow overwriting existing newer reviews (default: false)
  --apply                        Execute mutations against Convex (default: dry-run)
  -h, --help                     Show this help message

Environment:
  JOURNAL_ADMIN_SECRET           Preferred Bearer secret for /internal/journal/admin/*
  SERVICE_SHARED_SECRET          Fallback Bearer secret when JOURNAL_ADMIN_SECRET is unset
  CONVEX_SITE_URL                Default for --convex-site-url
  JOURNAL_OWNER_ID               Default for --owner-id`);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireArrayField(value, fieldName, recordContext) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(`${recordContext}: ${fieldName} cannot be an empty string.`);
    }
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(`${recordContext}: ${fieldName} is not valid JSON.`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`${recordContext}: ${fieldName} must decode to an array.`);
    }
    return parsed;
  }
  throw new Error(`${recordContext}: ${fieldName} must be an array.`);
}

function parseOptionalUpdatedAt(raw, recordContext) {
  const candidate = raw.updatedAt ?? raw.updated_at;
  if (candidate === undefined || candidate === null) return undefined;
  if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate <= 0) {
    throw new Error(`${recordContext}: updatedAt must be a positive integer timestamp.`);
  }
  return candidate;
}

function normalizeTradeRow(raw, index) {
  if (!isPlainObject(raw)) {
    throw new Error(`Trade[${index}] must be an object.`);
  }
  const stableId = raw.stableId ?? raw.id;
  if (typeof stableId !== "string" || stableId.trim().length === 0) {
    throw new Error(`Trade[${index}] is missing a valid id/stableId.`);
  }
  const context = `Trade(${stableId})`;
  const mistakes = requireArrayField(raw.mistakes, "mistakes", context);
  const assistantReview = raw.assistantReview ?? raw.assistant_review ?? null;
  const updatedAt = parseOptionalUpdatedAt(raw, context);

  return {
    stableId: stableId.trim(),
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
      mistakes,
    },
    assistantReview: assistantReview === undefined ? null : assistantReview,
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
}

function normalizeOrderBatchRow(raw, index) {
  if (!isPlainObject(raw)) {
    throw new Error(`OrderBatch[${index}] must be an object.`);
  }
  const stableId = raw.stableId ?? raw.id;
  if (typeof stableId !== "string" || stableId.trim().length === 0) {
    throw new Error(`OrderBatch[${index}] is missing a valid id/stableId.`);
  }
  const context = `OrderBatch(${stableId})`;
  const orders = requireArrayField(raw.orders, "orders", context);
  const updatedAt = parseOptionalUpdatedAt(raw, context);

  return {
    stableId: stableId.trim(),
    date: raw.date,
    note: raw.note ?? "",
    orders,
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
}

function normalizeLessonRow(raw, index) {
  if (!isPlainObject(raw)) {
    throw new Error(`Lesson[${index}] must be an object.`);
  }
  const stableId = raw.stableId ?? raw.id;
  if (typeof stableId !== "string" || stableId.trim().length === 0) {
    throw new Error(`Lesson[${index}] is missing a valid id/stableId.`);
  }
  const context = `Lesson(${stableId})`;
  const updatedAt = parseOptionalUpdatedAt(raw, context);

  return {
    stableId: stableId.trim(),
    lesson: {
      title: raw.title ?? "",
      body: raw.body ?? "",
      tradeStableId: raw.tradeStableId ?? raw.tradeId ?? raw.trade_id ?? null,
    },
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
}

function assertUniqueStableIds(items, kind) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.stableId)) {
      throw new Error(`Duplicate ${kind} stableId detected: ${item.stableId}`);
    }
    seen.add(item.stableId);
  }
}

function discoverSqliteOwners(db, tables) {
  const owners = new Set();
  if (tables.has("trades")) {
    for (const row of db.prepare("SELECT DISTINCT owner_id FROM trades").all()) {
      if (row.owner_id) owners.add(String(row.owner_id));
    }
  }
  if (tables.has("lessons")) {
    for (const row of db.prepare("SELECT DISTINCT owner_id FROM lessons").all()) {
      if (row.owner_id) owners.add(String(row.owner_id));
    }
  }
  if (tables.has("order_imports")) {
    for (const row of db.prepare("SELECT DISTINCT claimed_user_id, owner_email FROM order_imports").all()) {
      if (row.claimed_user_id) owners.add(String(row.claimed_user_id));
      if (row.owner_email) owners.add(String(row.owner_email));
    }
  }
  return [...owners].sort();
}

function loadFromSqlite(sqlitePath, requestedSourceOwner) {
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => String(row.name)),
    );

    const discoveredOwners = discoverSqliteOwners(db, tables);
    let selectedOwner = requestedSourceOwner?.trim() || undefined;
    if (!selectedOwner) {
      if (discoveredOwners.length > 1) {
        throw new Error(
          `SQLite database contains multiple owners (${discoveredOwners.join(", ")}). Pass --source-owner <email-or-id> to select one.`,
        );
      }
      selectedOwner = discoveredOwners[0];
    }

    const trades = [];
    if (tables.has("trades")) {
      const rows = selectedOwner
        ? db.prepare("SELECT * FROM trades WHERE owner_id = ?").all(selectedOwner)
        : db.prepare("SELECT * FROM trades").all();
      rows.forEach((row, index) => trades.push(normalizeTradeRow(row, index)));
    }

    const orderDays = [];
    if (tables.has("order_imports")) {
      const rows = selectedOwner
        ? db
          .prepare("SELECT * FROM order_imports WHERE claimed_user_id = ? OR owner_email = ?")
          .all(selectedOwner, selectedOwner)
        : db.prepare("SELECT * FROM order_imports").all();
      rows.forEach((row, index) => {
        orderDays.push(normalizeOrderBatchRow(row, index));
        if (row.pending_trades !== null && row.pending_trades !== undefined) {
          const pendingTrades = requireArrayField(
            row.pending_trades,
            "pending_trades",
            `OrderBatch(${row.id})`,
          );
          pendingTrades.forEach((pending, pendingIndex) => {
            trades.push(normalizeTradeRow(pending, pendingIndex));
          });
        }
      });
    }

    const lessons = [];
    if (tables.has("lessons")) {
      const rows = selectedOwner
        ? db.prepare("SELECT * FROM lessons WHERE owner_id = ?").all(selectedOwner)
        : db.prepare("SELECT * FROM lessons").all();
      rows.forEach((row, index) => lessons.push(normalizeLessonRow(row, index)));
    }

    assertUniqueStableIds(trades, "trade");
    assertUniqueStableIds(orderDays, "order batch");
    assertUniqueStableIds(lessons, "lesson");

    return {
      sourceOwner: selectedOwner ?? "(none)",
      trades,
      orderDays,
      lessons,
    };
  } finally {
    db.close();
  }
}

function requireOptionalCollectionArray(raw, key) {
  if (!(key in raw) || raw[key] === undefined) return undefined;
  if (!Array.isArray(raw[key])) {
    throw new Error(`Export JSON field "${key}" must be an array.`);
  }
  return raw[key];
}

async function loadFromExportJson(jsonPath) {
  const raw = JSON.parse(await readFile(jsonPath, "utf8"));
  if (!isPlainObject(raw)) {
    throw new Error("Export JSON root must be a JSON object.");
  }

  const rawTrades = requireOptionalCollectionArray(raw, "trades");
  const rawLessons = requireOptionalCollectionArray(raw, "lessons");
  const orderKeys = ["orderDays", "orderBatches", "order_imports"].filter((key) => key in raw);
  if (orderKeys.length > 1) {
    throw new Error(`Export JSON contains ambiguous order batch keys: ${orderKeys.join(", ")}.`);
  }
  const rawOrders = orderKeys[0] ? requireOptionalCollectionArray(raw, orderKeys[0]) : undefined;

  if (rawTrades === undefined && rawLessons === undefined && rawOrders === undefined) {
    throw new Error(
      "Export JSON must contain at least one of: trades, lessons, orderDays, orderBatches, or order_imports.",
    );
  }

  const trades = (rawTrades ?? []).map((row, index) => normalizeTradeRow(row, index));
  const orderDays = [];
  for (const [index, row] of (rawOrders ?? []).entries()) {
    orderDays.push(normalizeOrderBatchRow(row, index));
    const pendingRaw = row.pendingTrades ?? row.pending_trades;
    if (pendingRaw !== undefined && pendingRaw !== null) {
      const pendingTrades = requireArrayField(
        pendingRaw,
        "pendingTrades",
        `OrderBatch(${row.stableId ?? row.id ?? index})`,
      );
      pendingTrades.forEach((pending, pendingIndex) => {
        trades.push(normalizeTradeRow(pending, pendingIndex));
      });
    }
  }
  const lessons = (rawLessons ?? []).map((row, index) => normalizeLessonRow(row, index));

  assertUniqueStableIds(trades, "trade");
  assertUniqueStableIds(orderDays, "order batch");
  assertUniqueStableIds(lessons, "lesson");

  return {
    sourceOwner: "(export-json)",
    trades,
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
  const chartsByHash = new Map();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    const mimeType = MIME_BY_EXT.get(ext);
    if (!mimeType) continue;
    const filePath = path.join(chartsDir, entry.name);
    const bytes = await readFile(filePath);
    const imageKey = createHash("sha256").update(bytes).digest("hex");
    if (chartsByHash.has(imageKey)) continue;
    const { symbol, interval } = inferChartMetadata(entry.name);
    chartsByHash.set(imageKey, {
      filename: entry.name,
      filePath,
      mimeType,
      bytes,
      imageKey,
      symbol,
      interval,
    });
  }
  return [...chartsByHash.values()].sort((a, b) => a.filename.localeCompare(b.filename));
}

function collectReferencedChartKeys(trades) {
  const keys = new Set();
  for (const entry of trades) {
    if (entry.assistantReview === null || entry.assistantReview === undefined) continue;
    let parsed = null;
    if (typeof entry.assistantReview === "string") {
      if (!entry.assistantReview.trimStart().startsWith("{")) continue;
      try {
        parsed = JSON.parse(entry.assistantReview);
      } catch {
        throw new Error(`Trade ${entry.stableId} has invalid JSON in assistantReview.`);
      }
    } else if (isPlainObject(entry.assistantReview)) {
      parsed = entry.assistantReview;
    } else {
      throw new Error(`Trade ${entry.stableId} has unsupported assistantReview type.`);
    }
    if (!isPlainObject(parsed) || !Array.isArray(parsed.charts)) {
      throw new Error(`Trade ${entry.stableId} structured assistantReview is missing charts array.`);
    }
    for (const chart of parsed.charts) {
      if (!isPlainObject(chart) || typeof chart.image !== "string" || !SHA256_HEX_PATTERN.test(chart.image)) {
        throw new Error(`Trade ${entry.stableId} structured assistantReview has an invalid chart.image hash.`);
      }
      keys.add(chart.image);
    }
  }
  return keys;
}

function runPreflightChecks(data, charts) {
  const localChartByKey = new Map(charts.map((chart) => [chart.imageKey, chart]));
  const referencedKeys = collectReferencedChartKeys(data.trades);
  const missingKeys = [];
  for (const key of referencedKeys) {
    const localChart = localChartByKey.get(key);
    if (!localChart) {
      missingKeys.push(key);
      continue;
    }
    const recomputed = createHash("sha256").update(localChart.bytes).digest("hex");
    if (recomputed !== key) {
      throw new Error(`Chart file ${localChart.filename} SHA-256 mismatch: expected ${key}, got ${recomputed}.`);
    }
  }
  if (missingKeys.length > 0) {
    throw new Error(
      `Preflight failed: ${missingKeys.length} chart image key(s) referenced in structured reviews were not found locally: ${missingKeys.join(", ")}`,
    );
  }

  const tradeIds = new Set(data.trades.map((entry) => entry.stableId));
  const danglingLessons = [];
  for (const entry of data.lessons) {
    if (entry.lesson.tradeStableId !== null && !tradeIds.has(entry.lesson.tradeStableId)) {
      danglingLessons.push(`${entry.stableId} -> ${entry.lesson.tradeStableId}`);
    }
  }
  if (danglingLessons.length > 0) {
    throw new Error(
      `Preflight failed: ${danglingLessons.length} lesson(s) reference missing trades: ${danglingLessons.join(", ")}`,
    );
  }
}

async function postAdminJournalApi(baseUrl, secret, routePath, payload) {
  const url = `${baseUrl.replace(/\/+$/, "")}${routePath}`;
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
      "x-journal-admin-migration": "true",
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
      "source-owner": { type: "string" },
      "charts-dir": { type: "string", default: DEFAULT_CHARTS_DIR },
      "convex-site-url": { type: "string" },
      "owner-id": { type: "string" },
      "replace-reviews": { type: "boolean", default: false },
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
  const replaceExistingReviews = Boolean(values["replace-reviews"]);
  const apply = Boolean(values.apply);
  const adminSecret = process.env.JOURNAL_ADMIN_SECRET?.trim() || process.env.SERVICE_SHARED_SECRET?.trim() || "";

  if (apply) {
    if (!convexSiteUrl.trim()) {
      throw new Error("--convex-site-url (or CONVEX_SITE_URL) is required with --apply.");
    }
    if (!ownerId.trim()) {
      throw new Error("--owner-id (or JOURNAL_OWNER_ID) is required with --apply.");
    }
    if (!adminSecret) {
      throw new Error("JOURNAL_ADMIN_SECRET or SERVICE_SHARED_SECRET is required with --apply.");
    }
  }

  const data = exportJsonPath
    ? await loadFromExportJson(exportJsonPath)
    : loadFromSqlite(sqlitePath, values["source-owner"]);
  const charts = await scanChartsDir(chartsDir);

  // Preflight ALL chart hashes and lesson->trade references before any write request.
  runPreflightChecks(data, charts);

  const reviewCount = data.trades.filter((entry) => entry.assistantReview !== null).length;

  console.log(`Mode:             ${apply ? "APPLY (live writes)" : "DRY-RUN (no writes)"}`);
  console.log(`Source:           ${exportJsonPath ?? sqlitePath}`);
  console.log(`Source owner:     ${data.sourceOwner}`);
  console.log(`Charts dir:       ${chartsDir}`);
  console.log(`Convex site URL:  ${convexSiteUrl || "(not set)"}`);
  console.log(`Target owner ID:  ${ownerId || "(not set)"}`);
  console.log(`Replace reviews:  ${replaceExistingReviews}`);
  console.log("Summary:");
  console.log(`  Charts:         ${charts.length}`);
  console.log(`  Order batches:  ${data.orderDays.length}`);
  console.log(`  Trades:         ${data.trades.length}`);
  console.log(`  Reviews:        ${reviewCount}`);
  console.log(`  Lessons:        ${data.lessons.length}`);
  console.log("Preflight:        OK (all chart SHA-256 hashes and lesson trade references verified)");

  if (!apply) {
    console.log("\nDry-run complete. Re-run with --apply to migrate.");
    return;
  }

  // 1. Upload verified charts via admin endpoint (deduplicated by ownerId + imageKey)
  for (const chart of charts) {
    const payload = {
      ownerId,
      base64Data: chart.bytes.toString("base64"),
      mimeType: chart.mimeType,
      source: "migration",
      ...(chart.symbol ? { symbol: chart.symbol } : {}),
      ...(chart.interval ? { interval: chart.interval } : {}),
    };
    const uploaded = await postAdminJournalApi(
      convexSiteUrl,
      adminSecret,
      "/internal/journal/admin/upload-chart",
      payload,
    );
    console.log(`Uploaded chart ${chart.filename} -> ${uploaded.imageKey}`);
  }

  // 2. Atomically migrate order batches, trades, reviews, and lessons preserving updatedAt
  const migrated = await postAdminJournalApi(
    convexSiteUrl,
    adminSecret,
    "/internal/journal/admin/migrate",
    {
      ownerId,
      replaceExistingReviews,
      orderDays: data.orderDays,
      trades: data.trades,
      lessons: data.lessons,
    },
  );
  console.log(
    `Migrated atomically: ${migrated.orderDays} order batch(es), ${migrated.trades} trade(s), ${migrated.lessons} lesson(s), ${migrated.preservedReviews} existing review(s) preserved.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
