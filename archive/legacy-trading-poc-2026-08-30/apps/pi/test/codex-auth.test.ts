import { describe, expect, it } from "vitest";
import { authPathFromEnvironment } from "../src/auth/codex-cli.js";

describe("Codex authentication configuration", () => {
  it("uses the explicit Pi auth path and does not default to a user Codex file", () => {
    expect(authPathFromEnvironment({ PI_AUTH_PATH: "/data/auth.json" })).toBe("/data/auth.json");
    expect(authPathFromEnvironment({})).toBe("/data/auth.json");
    expect(authPathFromEnvironment({ PI_AUTH_PATH: "  /volume/codex.json  " })).toBe("/volume/codex.json");
  });
});
