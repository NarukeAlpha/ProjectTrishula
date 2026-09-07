import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executionRequest,
  executionServiceName,
  executionUrl,
} from "../convex/lib/execution.js";

const originalDomainSuffix = process.env.EXECUTION_PRIVATE_DOMAIN_SUFFIX;
const originalSharedSecret = process.env.SERVICE_SHARED_SECRET;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalDomainSuffix === undefined) delete process.env.EXECUTION_PRIVATE_DOMAIN_SUFFIX;
  else process.env.EXECUTION_PRIVATE_DOMAIN_SUFFIX = originalDomainSuffix;
  if (originalSharedSecret === undefined) delete process.env.SERVICE_SHARED_SECRET;
  else process.env.SERVICE_SHARED_SECRET = originalSharedSecret;
});

describe("actor-derived Pi routing", () => {
  it("derives the documented deterministic service name", async () => {
    await expect(executionServiceName("user_01HWORKOSALLOWED")).resolves.toBe(
      "pi-u-f5bd51748dab9767072f",
    );
  });

  it("keeps distinct actors on distinct private service URLs", async () => {
    process.env.EXECUTION_PRIVATE_DOMAIN_SUFFIX = "railway.internal:8080";
    process.env.SERVICE_SHARED_SECRET = "test-only-secret";

    const first = await executionUrl("user_01HWORKOSALLOWED", "/runs");
    const second = await executionUrl("user_01HWORKOSSECOND", "/runs");

    expect(first).toBe(
      "http://pi-u-f5bd51748dab9767072f.railway.internal:8080/runs",
    );
    expect(second).not.toBe(first);
  });

  it("passes an explicit deadline signal to bounded execution requests", async () => {
    process.env.EXECUTION_PRIVATE_DOMAIN_SUFFIX = "railway.internal:8080";
    process.env.SERVICE_SHARED_SECRET = "test-only-secret";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 202 }),
    );

    await executionRequest(
      "user_01HWORKOSALLOWED",
      "/market-research/jobs",
      { editionId: "MR-2026-09-07" },
      { timeoutMs: 15_000 },
    );

    const request = fetchMock.mock.calls[0];
    const init = request?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(false);
  });
});
