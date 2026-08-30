import { describe, expect, it } from "vitest";
import { serviceHealth } from "../src/service.js";

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
      },
    });
  });
});
