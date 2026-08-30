import { describe, expect, it } from "vitest";
import { assertProposalApprovable } from "../convex/lib/trade_approval.js";

const now = 2_000_000;

describe("trade proposal approval", () => {
  it("accepts the exact reviewed fingerprint before expiry", () => {
    expect(() =>
      assertProposalApprovable(
        {
          fingerprint: "reviewed",
          status: "awaiting_confirmation",
          expiresAt: now + 1,
        },
        "reviewed",
        now,
      ),
    ).not.toThrow();
  });

  it("rejects changed order details", () => {
    expect(() =>
      assertProposalApprovable(
        {
          fingerprint: "reviewed",
          status: "awaiting_confirmation",
          expiresAt: now + 1,
        },
        "changed",
        now,
      ),
    ).toThrow("details changed");
  });

  it("rejects duplicate and expired approvals", () => {
    expect(() =>
      assertProposalApprovable(
        { fingerprint: "reviewed", status: "submitted", expiresAt: now + 1 },
        "reviewed",
        now,
      ),
    ).toThrow("no longer awaiting");
    expect(() =>
      assertProposalApprovable(
        {
          fingerprint: "reviewed",
          status: "awaiting_confirmation",
          expiresAt: now,
        },
        "reviewed",
        now,
      ),
    ).toThrow("expired");
  });
});
