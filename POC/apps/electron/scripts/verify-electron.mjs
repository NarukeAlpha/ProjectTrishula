import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const requiredFiles = [
  "apps/electron/main.cjs",
  "apps/electron/preload.cjs",
  "apps/electron/index.html",
  "apps/electron/renderer.js",
  "apps/electron/styles.css",
];

const requiredText = [
  "workbench.topAppBar",
  "workbench.leftRail",
  "workbench.marketWorkspace",
  "workbench.rightPanel",
  "workbench.bottomDock",
  "workbench.reviewPaperAction",
  "workbench.symbolSearch",
  "/v1/app/settings",
  "/v1/app/watchlist",
  "/v1/workbench/live",
  "fetchLiveWorkbench",
  "selectSymbol",
  "reviewPaper",
  "No symbol selected",
  "No IBKR options feed",
  "SQLite ready",
  "data-chart-toggle",
  "Review Paper",
  "Live",
  "IBKR Market Data",
  "priceChart",
  "tradingBridge",
];

const forbiddenText = [
  "readSharedData",
  "workbench-data.json",
  "Fixture Fallback",
  "fallbackData",
  "fallback",
  "TradingSwiftApp",
  "apps/swift",
  "query2" + ".finance",
  "req" + "west::Client",
  "External live market " + "fetch",
];

const missingFiles = requiredFiles.filter((file) => !fs.existsSync(path.join(repoRoot, file)));
const sources = requiredFiles
  .filter((file) => fs.existsSync(path.join(repoRoot, file)))
  .map((file) => [file, fs.readFileSync(path.join(repoRoot, file), "utf8")]);
const allSourceText = sources.map(([_file, content]) => content).join("\n");
const missingText = requiredText.filter((needle) => !allSourceText.includes(needle));
const forbiddenMatches = forbiddenText.filter((needle) => allSourceText.includes(needle));

const interactionChecks = [
  ["symbol submit", allSourceText.includes('".symbol-search"') && allSourceText.includes("selectSymbol(")],
  ["watchlist rows", allSourceText.includes("watch-row") && allSourceText.includes("addEventListener(\"click\"")],
  ["timeframe buttons", allSourceText.includes("activeTimeframe") && allSourceText.includes("refreshSelected()")],
  ["right tabs", allSourceText.includes("activeRightTab")],
  ["dock tabs", allSourceText.includes("activeDock")],
  ["paper review", allSourceText.includes("data-action=\"review-paper\"") && allSourceText.includes("reviewPaper()")],
  ["range buttons", allSourceText.includes("[data-range]") && allSourceText.includes("activeRange")],
  ["chart toggles", allSourceText.includes("[data-chart-toggle]") && allSourceText.includes("chartToggle")],
];
const failedInteractionChecks = interactionChecks.filter(([_name, ok]) => !ok).map(([name]) => name);

const isApproved =
  missingFiles.length === 0 &&
  missingText.length === 0 &&
  forbiddenMatches.length === 0 &&
  failedInteractionChecks.length === 0;
const trace = {
  verifier: "electron-live-workstation-contract",
  isApproved,
  requiredFiles,
  missingFiles,
  missingText,
  forbiddenMatches,
  failedInteractionChecks,
};

const outputIndex = process.argv.indexOf("--output");
if (outputIndex !== -1 && process.argv[outputIndex + 1]) {
  fs.mkdirSync(path.dirname(process.argv[outputIndex + 1]), { recursive: true });
  fs.writeFileSync(process.argv[outputIndex + 1], `${JSON.stringify(trace, null, 2)}\n`);
}

if (!isApproved) {
  console.error(JSON.stringify(trace, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(trace));
