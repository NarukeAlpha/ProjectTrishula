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
  "frontend/shared/workbench-data.json",
];

const requiredText = [
  "workbench.topAppBar",
  "workbench.leftRail",
  "workbench.marketWorkspace",
  "workbench.rightPanel",
  "workbench.bottomDock",
  "workbench.reviewPaperAction",
  "Options Chain",
  "Diagnostics",
  "External evidence pending",
  "Review Paper",
  "Live",
  "priceChart",
  "tradingBridge",
];

const sources = requiredFiles.map((file) => [
  file,
  fs.readFileSync(path.join(repoRoot, file), "utf8"),
]);

const missingFiles = requiredFiles.filter((file) => !fs.existsSync(path.join(repoRoot, file)));
const missingText = requiredText.filter(
  (needle) => !sources.some(([_file, content]) => content.includes(needle))
);

const data = JSON.parse(fs.readFileSync(path.join(repoRoot, "frontend/shared/workbench-data.json"), "utf8"));
const dataChecks = [
  ["workspace modes", data.workspaceModes?.length === 3],
  ["watchlist", data.watchlists?.length >= 8],
  ["bars", data.bars?.length >= 30],
  ["levels", data.levels?.length >= 6],
  ["options chain", data.optionsChain?.length >= 6],
  ["risk warnings", data.risk?.warnings?.length >= 3],
  ["diagnostics", data.diagnostics?.length >= 3],
];
const failedDataChecks = dataChecks.filter(([_name, ok]) => !ok).map(([name]) => name);

const isApproved = missingFiles.length === 0 && missingText.length === 0 && failedDataChecks.length === 0;
const trace = {
  verifier: "electron-frontend-contract",
  isApproved,
  requiredFiles,
  missingFiles,
  requiredText,
  missingText,
  failedDataChecks,
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
