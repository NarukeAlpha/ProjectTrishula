import { execFileSync } from "node:child_process";

const buildContexts = {
  "convex-functions": ["apps/convex", "infra/railway/convex-functions"],
  pi: ["apps/pi"],
  discord: ["apps/discord"],
  web: ["apps/web"],
};

export function fullCommit(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/i.test(value);
}

function gitObject(reference) {
  return execFileSync("git", ["rev-parse", "--verify", reference], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5_000,
  }).trim();
}

// GitHub watch paths can deploy services at different commits. Compare every
// Docker build input, not the commit label, to verify a staged release.
export function deploymentMatchesSource(service, deployedCommit, expectedCommit, resolve = gitObject) {
  if (!fullCommit(deployedCommit) || !fullCommit(expectedCommit)) return false;
  const paths = buildContexts[service];
  if (!paths) return false;
  try {
    return paths.every((path) => {
      const deployed = resolve(`${deployedCommit}:${path}`);
      const expected = resolve(`${expectedCommit}:${path}`);
      return fullCommit(deployed) && deployed === expected;
    });
  } catch {
    return false;
  }
}
