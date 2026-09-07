import { describe, expect, it, vi } from "vitest";
import { pollMarketResearchSafely, serviceHealth } from "../src/service.js";

describe("serviceHealth", () => {
  it("stays healthy but not ready before the Discord token is configured", () => {
    expect(
      serviceHealth({
        configured: false,
        connected: false,
        guildCount: 0,
        readyAt: null,
      }),
    ).toEqual({
      statusCode: 200,
      body: {
        status: "not_configured",
        discord: {
          configured: false,
          connected: false,
          guildCount: 0,
          readyAt: null,
        },
        marketResearch: {
          enabled: false,
          chartsEnabled: false,
        },
      },
    });
  });

  it("observes a rejected initial or interval market-research poll", async () => {
    const onFailure = vi.fn();
    pollMarketResearchSafely(
      vi.fn().mockRejectedValue(new Error("publication unavailable")),
      onFailure,
    );
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledOnce());
  });
});
