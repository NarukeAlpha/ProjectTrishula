export interface ApprovalCandidate {
  fingerprint: string;
  status: string;
  expiresAt: number;
}

export function assertProposalApprovable(
  proposal: ApprovalCandidate,
  suppliedFingerprint: string,
  now: number,
): void {
  if (proposal.fingerprint !== suppliedFingerprint) {
    throw new Error("Trade proposal details changed. Review the new proposal.");
  }
  if (proposal.status !== "awaiting_confirmation") {
    throw new Error("Trade proposal is no longer awaiting confirmation.");
  }
  if (proposal.expiresAt <= now) {
    throw new Error("Trade proposal expired. Request a new review.");
  }
}
