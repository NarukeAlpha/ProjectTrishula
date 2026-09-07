import { describe, expect, it } from "vitest";
import {
  PersonalityNativeProbeError,
  personalityProbeFailureOutput,
} from "../src/probes/personality.js";
import { PersonalityProbeTransportDiagnostics } from "../src/probes/personality-transport-diagnostics.js";

const endpoint = "https://chatgpt.com/backend-api/codex/responses";

describe("personality probe transport diagnostics", () => {
  it("reports bounded HTTP error metadata without request, response, or credential content", async () => {
    const secret = "secret-prompt-and-opaque-artifact";
    const diagnostics = new PersonalityProbeTransportDiagnostics(async () =>
      new Response(JSON.stringify({
        error: {
          code: "unsupported_beta",
          param: "input",
          type: "invalid_request_error",
          message: secret,
        },
      }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      }));

    await diagnostics.fetchFor("native_compaction")(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      body: JSON.stringify({ input: secret }),
    });

    const snapshot = await diagnostics.snapshot();
    expect(snapshot).toEqual([{
      phase: "native_compaction",
      request: 1,
      endpoint: "chatgpt_codex_responses",
      outcome: "response",
      httpStatus: 400,
      responseMedia: "json",
      providerErrorCode: "unsupported_beta",
      providerErrorParam: "input",
      providerErrorType: "invalid_request_error",
    }]);
    expect(JSON.stringify(snapshot)).not.toContain(secret);
    expect(JSON.stringify(snapshot)).not.toContain("authorization");
    expect(JSON.stringify(snapshot)).not.toContain("message");
  });

  it("extracts only safe error fields from a successful SSE transport", async () => {
    const secret = "do-not-print-this-provider-detail";
    const diagnostics = new PersonalityProbeTransportDiagnostics(async () =>
      new Response([
        "data: {\"type\":\"response.created\",\"response\":{\"id\":\"response-secret\"}}",
        "",
        `data: ${JSON.stringify({
          type: "response.failed",
          response: { error: { code: "remote_compaction_unavailable", type: "server_error", message: secret } },
        })}`,
        "",
        "data: [DONE]",
        "",
      ].join("\n"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }));

    await diagnostics.fetchFor("same_process_continuation")(endpoint);
    const snapshot = await diagnostics.snapshot();
    expect(snapshot).toEqual([{
      phase: "same_process_continuation",
      request: 1,
      endpoint: "chatgpt_codex_responses",
      outcome: "response",
      httpStatus: 200,
      responseMedia: "sse",
      providerErrorCode: "remote_compaction_unavailable",
      providerErrorType: "server_error",
    }]);
    expect(JSON.stringify(snapshot)).not.toContain(secret);
    expect(JSON.stringify(snapshot)).not.toContain("response-secret");
  });

  it("omits an unrecognized provider parameter while retaining safe error fields", async () => {
    const diagnostics = new PersonalityProbeTransportDiagnostics(async () =>
      new Response(JSON.stringify({
        error: {
          code: "invalid_request",
          param: "input[0].secret-user-content",
          type: "invalid_request_error",
        },
      }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }));

    await diagnostics.fetchFor("native_compaction")(endpoint);
    expect(await diagnostics.snapshot()).toEqual([{
      phase: "native_compaction",
      request: 1,
      endpoint: "chatgpt_codex_responses",
      outcome: "response",
      httpStatus: 400,
      responseMedia: "json",
      providerErrorCode: "invalid_request",
      providerErrorType: "invalid_request_error",
    }]);
  });

  it("reports a sanitized network failure without its message or URL", async () => {
    const diagnostics = new PersonalityProbeTransportDiagnostics(async () => {
      const error = new TypeError("fetch failed for https://secret.invalid?token=secret");
      error.cause = { code: "UND_ERR_CONNECT_TIMEOUT", detail: "secret" };
      throw error;
    });

    await expect(diagnostics.fetchFor("fresh_runtime_continuation")(endpoint))
      .rejects.toThrow();
    const snapshot = await diagnostics.snapshot();
    expect(snapshot).toEqual([{
      phase: "fresh_runtime_continuation",
      request: 1,
      endpoint: "chatgpt_codex_responses",
      outcome: "transport_error",
      errorName: "TypeError",
      errorCode: "UND_ERR_CONNECT_TIMEOUT",
    }]);
    expect(JSON.stringify(snapshot)).not.toContain("secret.invalid");
    expect(JSON.stringify(snapshot)).not.toContain("token");
  });

  it("formats the native CLI failure as structured diagnostic evidence", () => {
    const report = {
      ok: false as const,
      mode: "native_compaction" as const,
      phase: "native_compaction" as const,
      errorCode: "provider_request_failed" as const,
      transportRequestCount: 1,
      transport: [{
        phase: "native_compaction" as const,
        request: 1,
        endpoint: "chatgpt_codex_responses" as const,
        outcome: "response" as const,
        httpStatus: 403,
        responseMedia: "json" as const,
        providerErrorCode: "feature_not_enabled",
        providerErrorType: "invalid_request_error",
      }],
      nativeResponse: {
        bodyRead: "complete" as const,
        dataEventCount: 2,
        doneMarkerCount: 1,
        createdEventCount: 0,
        outputItemDoneEventCount: 1,
        compactionOutputItemCount: 1,
        otherOutputItemCount: 0,
        completedEventCount: 1,
        doneEventCount: 0,
        failureEventCount: 0,
        otherEventCount: 0,
        result: "rejected" as const,
        failureCategory: "terminal_status_invalid" as const,
      },
    };
    expect(JSON.parse(personalityProbeFailureOutput(
      new PersonalityNativeProbeError(report),
    ))).toEqual(report);
  });
});
