import type { ModelsSimpleStreamOptions } from "@earendil-works/pi-ai";
import { z } from "zod";
import { ASTRA_CODEX_MODEL_ID } from "./codex-catalog.js";

interface CodexStreamOptions extends ModelsSimpleStreamOptions {
  serviceTier?: string;
}

/** Pi 0.84.1 drops serviceTier in streamSimple; preserve the requested tier for Astra. */
export function withAstraServiceTier(
  model: { id: string; provider: string },
  options: CodexStreamOptions,
): CodexStreamOptions {
  const serviceTier = options.serviceTier;
  if (model.provider !== "openai-codex" || model.id !== ASTRA_CODEX_MODEL_ID || serviceTier === undefined) return options;
  return {
    ...options,
    onPayload: async (payload, payloadModel) => {
      const request = { ...z.record(z.string(), z.unknown()).parse(payload), service_tier: serviceTier };
      const result = await options.onPayload?.(request, payloadModel);
      return { ...z.record(z.string(), z.unknown()).parse(result ?? request), service_tier: serviceTier };
    },
  };
}
