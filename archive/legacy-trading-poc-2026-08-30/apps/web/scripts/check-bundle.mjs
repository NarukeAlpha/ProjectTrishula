import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const forbidden = [
  "AWS_SECRET_ACCESS_KEY",
  "WORKOS_API_KEY",
  "CONVEX_ADMIN_KEY",
  "CONVEX_DEPLOY_KEY",
  "SERVICE_SHARED_SECRET",
  "BACKEND_SERVICE_URL",
  "PI_SERVICE_URL",
  "ROBINHOOD_USERNAME",
  "ROBINHOOD_PASSWORD",
  "ROBINHOOD_ACCESS_TOKEN",
  "ROBINHOOD_REFRESH_TOKEN",
  "ROBINHOOD_SESSION_TOKEN",
  "BROKER_SESSION_COOKIE",
  "/service/run-results",
  "/service/run-heartbeats",
  "internalMutation",
  "internalAction",
];

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await files(item)));
    else output.push(item);
  }
  return output;
}

for (const file of await files(
  fileURLToPath(new URL("../dist", import.meta.url)),
)) {
  const content = await readFile(file, "utf8");
  for (const term of forbidden) {
    if (content.includes(term))
      throw new Error(
        `Forbidden browser artifact term found: ${term} in ${file}`,
      );
  }
}
console.log("Browser artifact boundary check passed.");
