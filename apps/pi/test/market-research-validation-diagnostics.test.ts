import { describe, expect, it, vi } from "vitest";
import { z, ZodError } from "zod";
import type { MarketResearchJobRequest } from "../src/market-research/contracts.js";
import { MarketResearchJobRegistry } from "../src/market-research/jobs.js";
import type { MarketResearchRunner } from "../src/market-research/runner.js";
import { marketResearchValidationDiagnostics } from "../src/market-research/validation-diagnostics.js";
import type { Logger } from "../src/runtime/logger.js";

const secret = "credential-and-private-source-text-that-must-not-be-logged";

function sensitiveValidationError(): ZodError {
  const issue = {
    code: "custom" as const,
    path: ["evidence", 4, "highlights", secret, Symbol(secret), "text"],
    message: secret,
    input: secret,
    params: { privateInput: secret },
  };
  return new ZodError([issue]);
}

describe("market-research validation diagnostics", () => {
  it("keeps technical schema paths without messages, values, or unknown path names", () => {
    const details = marketResearchValidationDiagnostics(sensitiveValidationError());
    expect(details).toEqual({
      issueCount: 1,
      truncated: false,
      issues: [{
        code: "custom",
        path: ["evidence", 4, "highlights", "field", "field", "text"],
        pathTruncated: false,
      }],
    });
    expect(JSON.stringify(details)).not.toContain(secret);
    expect(JSON.stringify(details)).not.toContain("privateInput");
  });

  it("reports fixed parser issue codes without unrecognized key names or rejected values", () => {
    const result = z.object({
      session: z.object({ editionLabel: z.literal("Morning Market Newspaper") }).strict(),
      sourceIds: z.array(z.string()),
    }).strict().safeParse({ session: { editionLabel: secret }, sourceIds: secret, [secret]: secret });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("The diagnostic fixture must fail.");
    const details = marketResearchValidationDiagnostics(result.error);
    expect(details.issues.map((issue) => issue.code)).toEqual(["invalid_value", "invalid_type", "unrecognized_keys"]);
    expect(details.issues.map((issue) => issue.path)).toEqual([["session", "editionLabel"], ["sourceIds"], []]);
    expect(JSON.stringify(details)).not.toContain(secret);
  });

  it("does not echo a nonstandard issue code", () => {
    const error = sensitiveValidationError();
    const issue = error.issues[0];
    if (!issue) throw new Error("Missing diagnostic fixture issue.");
    Object.assign(issue, { code: secret });
    const details = marketResearchValidationDiagnostics(error);
    expect(details.issues[0]?.code).toBe("unknown");
    expect(JSON.stringify(details)).not.toContain(secret);
  });

  it("bounds issue count and path depth, and replaces unsafe numeric indices", () => {
    const issues = Array.from({ length: 30 }, () => ({
      code: "custom" as const,
      message: secret,
      path: ["evidence", -1, Number.NaN, Number.POSITIVE_INFINITY, "sections", 3, "sourceIds", 2, secret],
    }));
    const details = marketResearchValidationDiagnostics(new ZodError(issues));
    expect(details.issueCount).toBe(12);
    expect(details.truncated).toBe(true);
    expect(details.issues).toHaveLength(12);
    expect(details.issues[0]).toEqual({
      code: "custom",
      path: ["evidence", "index", "index", "index", "sections", 3, "sourceIds", 2],
      pathTruncated: true,
    });
    expect(JSON.stringify(details)).not.toContain(secret);
  });

  it.each(["zod", "ordinary"] as const)("preserves job failure behavior for a %s cause", async (kind) => {
    const error = kind === "zod" ? sensitiveValidationError() : new Error(secret);
    const logger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runner: MarketResearchRunner = {
      initialize: async () => undefined,
      readiness: () => ({ ready: true }),
      run: async () => { throw error; },
      dispose: async () => undefined,
    };
    // SAFETY: This throwing runner never reads a job payload; the fixture includes every envelope field the registry reads.
    const request = { dispatchId: "job-1", editionId: "edition-1", ownerId: "owner-1", generation: 1 } as MarketResearchJobRequest;
    const registry = new MarketResearchJobRegistry({ runner, logger });
    try {
      registry.submit(request);
      await vi.waitFor(() => expect(registry.get(request.dispatchId, request.ownerId)).toEqual({
        jobId: "job-1", status: "failed", code: "exa_unavailable", retryable: true,
      }));
      const base = { editionId: "edition-1", generation: 1, code: "exa_unavailable" };
      expect(logger.error).toHaveBeenCalledExactlyOnceWith("market_research_job_failed", kind === "zod"
        ? { ...base, validation: marketResearchValidationDiagnostics(sensitiveValidationError()) }
        : base);
      expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(secret);
    } finally {
      await registry.dispose();
    }
  });
});
