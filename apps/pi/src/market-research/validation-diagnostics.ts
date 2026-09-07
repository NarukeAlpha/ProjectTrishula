/* oxlint-disable anti-slop/no-runtime-typeof -- Zod issue paths are an untrusted diagnostic boundary; only fixed schema names and safe numeric indices may leave it. */
import type { ZodError } from "zod";

const MAX_ISSUES = 12;
const MAX_PATH_DEPTH = 8;

const issueCodes = new Set([
  "invalid_type", "too_big", "too_small", "invalid_format", "not_multiple_of",
  "unrecognized_keys", "invalid_union", "invalid_key", "invalid_element",
  "invalid_value", "custom",
]);

const schemaFields = new Set([
  "schemaVersion", "dispatchId", "editionId", "ownerId", "guildId", "generation",
  "claimToken", "scheduledFor", "resumeFrom", "configurationSnapshotHash",
  "preferences", "retainedEvidenceIds", "session", "sessionType", "editionLabel",
  "editionDate", "timezone", "configuredLocalTime", "marketTime",
  "previousSessionDate", "previousSessionClose", "nextSessionDate", "calendarVersion",
  "evidence", "evidenceId", "kind", "provider", "sourcePolicy", "sourcePolicyVersion",
  "title", "url", "canonicalUrlHash", "author", "publishedAt", "providerTimestamp",
  "retrievedAt", "sessionLabel", "freshness", "contentStatus", "highlights",
  "normalizedClaims", "requestId", "costUsd", "contentHash", "generatedAt",
  "primarySymbols", "sectorSymbols", "discoverySymbols", "requestedSourceStatus",
  "source", "status", "detail", "allowedSourceIds", "missingFields", "conflicts",
  "conflictId", "field", "sourceIds", "edition", "asOf", "regime", "regimeLines",
  "topStories", "scheduledEvents", "marketContext", "primaryBoard", "challengers",
  "tickerDossiers", "validationRules", "afterOpenChanges", "dataQuality", "sections",
  "chartRequests", "noTradingAction", "symbol", "label", "score", "components",
  "catalyst", "liquidityAndSpread", "dailyAndHourlyBias", "premarketStructure",
  "levelQualityAndProximity", "indexAndSectorConfirmation", "deductions", "thesisLabel",
  "trigger", "invalidation", "firstResistanceOrTarget", "rewardToRisk", "noChase",
  "indexOrSectorCondition", "eventRisk", "text", "summary", "availableFields",
  "unavailableFields", "sectionId", "sequence", "heading", "markdown", "chartRequestId",
  "timeframe", "start", "end", "overlays", "annotations", "reason", "priority",
  "sourceEvidenceIds", "dataAsOf", "deliveries", "deliveryId", "idempotencyKey",
  "content", "chartAttachmentIds", "nonce", "exaRequestCount", "exaCostUsd", "completedAt",
  "thesisMemory", "thesisUpdates", "baseRevision", "revision", "catalysts",
  "openQuestions", "assessment", "changeSummary", "sources", "sourceId", "lastReviewedAt", "lastEditionId",
]);

function safePathComponent(component: PropertyKey): string | number {
  if (typeof component === "number") {
    return Number.isSafeInteger(component) && component >= 0 ? component : "index";
  }
  return typeof component === "string" && schemaFields.has(component) ? component : "field";
}

export function marketResearchValidationDiagnostics(error: ZodError) {
  const issues = error.issues.slice(0, MAX_ISSUES).map((issue) => ({
    code: issueCodes.has(issue.code) ? issue.code : "unknown",
    path: issue.path.slice(0, MAX_PATH_DEPTH).map(safePathComponent),
    pathTruncated: issue.path.length > MAX_PATH_DEPTH,
  }));
  return {
    issueCount: issues.length,
    truncated: error.issues.length > MAX_ISSUES,
    issues,
  };
}
