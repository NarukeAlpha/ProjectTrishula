import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrokerReturnPage, LegacyBrokerCallback } from "./BrokerReturn";

function LocationProbe() {
  const location = useLocation();
  return (
    <output aria-label="current location">
      {`${location.pathname}${location.search}${location.hash}`}
    </output>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("archived Robinhood return components", () => {
  it("scrubs unexpected parameters from a public result page", async () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/broker/failed?code=must-not-be-read&state=must-not-be-read#secret",
        ]}
      >
        <Routes>
          <Route
            path="/broker/failed"
            element={
              <>
                <BrokerReturnPage result="failed" />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      /could not finish the Robinhood connection/i,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent(
        /^\/broker\/failed$/,
      ),
    );
  });

  it("scrubs the legacy callback and performs no browser exchange", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <MemoryRouter
        initialEntries={[
          "/broker/callback?code=one-time-code&state=actor-bound-state",
        ]}
      >
        <Routes>
          <Route path="/broker/callback" element={<LegacyBrokerCallback />} />
          <Route
            path="/broker/failed"
            element={
              <>
                <BrokerReturnPage result="failed" />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent(
        /^\/broker\/failed$/,
      ),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
