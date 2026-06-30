import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");

const requiredFiles = [
  "frontend/shared/workbench-data.json",
  "apps/electron/main.cjs",
  "apps/electron/preload.cjs",
  "apps/electron/index.html",
  "apps/electron/renderer.js",
  "apps/electron/styles.css",
  "apps/swift/Package.swift",
  "apps/swift/Sources/TradingSwiftApp/main.swift",
];

const requiredConceptTerms = [
  "workbench.topAppBar",
  "workbench.leftRail",
  "workbench.marketWorkspace",
  "workbench.rightPanel",
  "workbench.bottomDock",
  "workbench.reviewPaperAction",
  "Research",
  "Paper",
  "Live Review",
  "Options Chain",
  "Diagnostics",
  "Review Paper",
  "External evidence pending",
  "NVDA",
  "1,213.49",
  "1,232.50",
];

const missingFiles = requiredFiles.filter((file) => !fs.existsSync(path.join(repoRoot, file)));
const sourcePairs = requiredFiles
  .filter((file) => fs.existsSync(path.join(repoRoot, file)))
  .map((file) => [file, fs.readFileSync(path.join(repoRoot, file), "utf8")]);

const sharedSources = sourcePairs.filter(([file]) => file.startsWith("frontend/shared/"));
const electronSources = sourcePairs.filter(([file]) => file.startsWith("apps/electron/")).concat(sharedSources);
const swiftSources = sourcePairs.filter(([file]) => file.startsWith("apps/swift/")).concat(sharedSources);
const allSourceText = sourcePairs.map(([_file, content]) => content).join("\n");
const oldWorkspaceReferences = sourcePairs
  .filter(([_file, content]) => content.includes("/Users/gabrielalfonzo/Documents/Agentic Trading"))
  .map(([file]) => file);

function missingTerms(sources) {
  const text = sources.map(([_file, content]) => content).join("\n");
  return requiredConceptTerms.filter((term) => !text.includes(term));
}

const data = JSON.parse(fs.readFileSync(path.join(repoRoot, "frontend/shared/workbench-data.json"), "utf8"));
const dataChecks = [
  ["three workspace modes", data.workspaceModes?.length === 3],
  ["watchlist has scanning density", data.watchlists?.length >= 8],
  ["chart has enough candles", data.bars?.length >= 30],
  ["price levels include targets and stops", data.levels?.length >= 6],
  ["option chain has enough rows", data.optionsChain?.length >= 6],
  ["risk warnings are present", data.risk?.warnings?.length >= 3],
  ["diagnostics are segregated", data.diagnostics?.length >= 3],
];

const failedDataChecks = dataChecks.filter(([_name, passed]) => !passed).map(([name]) => name);
const electronMissingTerms = missingTerms(electronSources);
const swiftMissingTerms = missingTerms(swiftSources);
const isApproved =
  missingFiles.length === 0 &&
  electronMissingTerms.length === 0 &&
  swiftMissingTerms.length === 0 &&
  failedDataChecks.length === 0 &&
  oldWorkspaceReferences.length === 0 &&
  allSourceText.includes("TradingSwiftApp") &&
  allSourceText.includes("tradingBridge");

const trace = {
  verifier: "frontend-parity",
  isApproved,
  requiredFiles,
  missingFiles,
  electronMissingTerms,
  swiftMissingTerms,
  failedDataChecks,
  oldWorkspaceReferences,
  parityRegions: [
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
