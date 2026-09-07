import assert from "node:assert/strict";
import test from "node:test";
import { deploymentMatchesSource, fullCommit } from "./deployment-source.mjs";

const deployed = "a".repeat(40);
const target = "b".repeat(40);
const object = "c".repeat(40);

test("requires full commit IDs instead of ambiguous refs", () => {
  assert.equal(fullCommit(deployed), true);
  for (const value of [null, "master", "a".repeat(7), "--all", "g".repeat(40)]) {
    assert.equal(fullCommit(value), false);
    assert.equal(deploymentMatchesSource("pi", value, target), false);
  }
});

test("accepts different commit labels with identical build input", () => {
  const references = [];
  assert.equal(deploymentMatchesSource("pi", deployed, target, (reference) => {
    references.push(reference);
    return object;
  }), true);
  assert.deepEqual(references, [`${deployed}:apps/pi`, `${target}:apps/pi`]);
});

test("checks the Convex functions and deployment infrastructure", () => {
  const references = [];
  assert.equal(deploymentMatchesSource("convex-functions", deployed, target, (reference) => {
    references.push(reference);
    return reference === `${target}:infra/railway/convex-functions` ? deployed : object;
  }), false);
  assert.deepEqual(references, [
    `${deployed}:apps/convex`, `${target}:apps/convex`,
    `${deployed}:infra/railway/convex-functions`, `${target}:infra/railway/convex-functions`,
  ]);
});

test("fails closed for missing git objects or unknown services", () => {
  assert.equal(deploymentMatchesSource("pi", deployed, target, () => { throw new Error("missing"); }), false);
  assert.equal(deploymentMatchesSource("pi", deployed, target, () => ""), false);
  assert.equal(deploymentMatchesSource("unknown", deployed, target, () => object), false);
});
