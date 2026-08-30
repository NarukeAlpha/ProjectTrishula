import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");

const requiredFiles = [
  "apps/electron/main.cjs",
  "apps/electron/preload.cjs",
  "apps/electron/index.html",
  "apps/electron/renderer.js",
  "apps/electron/styles.css",
  "src/lib.rs",
];

const requiredConceptTerms = [
  "workbench.topAppBar",
  "workbench.leftRail",
  "workbench.marketWorkspace",
  "workbench.rightPanel",
  "workbench.bottomDock",
  "workbench.reviewPaperAction",
  "workbench.symbolSearch",
  "Research",
  "Paper",
  "Live Review",
  "Options Chain",
  "Diagnostics",
  "Review Paper",
  "No symbol selected",
  "No IBKR options feed",
  "SQLite ready",
  "IBKR Market Data",
  "data-chart-toggle",
  "/v1/app/settings",
  "/v1/workbench/live",
];

const forbiddenRuntimeTerms = [
  "frontend/shared/workbench-data.json",
  "readSharedData",
  "Fixture Fallback",
  "fallbackData",
  "apps/swift",
  "TradingSwiftApp",
  "query2" + ".finance",
  "req" + "west::Client",
  "External live market " + "fetch",
];

const missingFiles = requiredFiles.filter((file) => !fs.existsSync(path.join(repoRoot, file)));
const sourcePairs = requiredFiles
  .filter((file) => fs.existsSync(path.join(repoRoot, file)))
  .map((file) => [file, fs.readFileSync(path.join(repoRoot, file), "utf8")]);
const sourceText = sourcePairs.map(([_file, content]) => content).join("\n");
const missingTerms = requiredConceptTerms.filter((term) => !sourceText.includes(term));
const forbiddenMatches = forbiddenRuntimeTerms.filter((term) => sourceText.includes(term));
const oldWorkspaceReferences = sourcePairs
  .filter(([_file, content]) => content.includes("/Users/gabrielalfonzo/Documents/Agentic Trading"))
  .map(([file]) => file);

const isApproved =
  missingFiles.length === 0 &&
  missingTerms.length === 0 &&
  forbiddenMatches.length === 0 &&
  oldWorkspaceReferences.length === 0;

const trace = {
  verifier: "electron-live-surface",
  isApproved,
  requiredFiles,
  missingFiles,
  missingTerms,
  forbiddenMatches,
  oldWorkspaceReferences,
  surfaceRegions: [
    "top app bar",
    "left rail",
    "center market workspace",
    "right decision panel",
    "bottom dock",
    "diagnostics",
  ],
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
