import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../app/theme-provider";
import { BestMatches } from "./BestMatches";

const matchingApi = vi.hoisted(() => ({ getSuggestions: vi.fn() }));
vi.mock("./matching-api", async (importOriginal) => ({ ...(await importOriginal<typeof import("./matching-api")>()), ...matchingApi }));

function renderPanel() {
  render(
    <ThemeProvider>
      <MemoryRouter>
        <BestMatches query={{ feature: "ride", from: "r1" }} />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe("Best matches (B9)", () => {
  beforeEach(() => {
    matchingApi.getSuggestions.mockReset();
  });

  it("lists suggestions with their score and reasons, each opening the item", async () => {
    matchingApi.getSuggestions.mockResolvedValue({
      feature: "ride",
      target: "ride_offer",
      sourceId: "r1",
      suggestions: [
        {
          rank: 1,
          score: 0.87,
          target: "ride_offer",
          reasons: [{ code: "PICKUP_NEAR", km: 0.4 }, { code: "TIME_CLOSE", minutes: 10 }],
          item: {
            id: "o1",
            pickup: { address: "Campus gate", lat: 1, lng: 1 },
            destination: { address: "Farmgate", lat: 2, lng: 2 },
            departureTime: "2026-11-21T03:00:00.000Z",
            rider: { name: "Karim" },
          },
        },
      ],
    });
    renderPanel();
    expect(await screen.findByText("87% match")).toBeInTheDocument();
    expect(screen.getByText("Pickup 0.4 km away")).toBeInTheDocument();
    expect(screen.getByText("10 min apart")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Campus gate → Farmgate/ })).toHaveAttribute("href", "/ride/offers/o1");
    expect(matchingApi.getSuggestions).toHaveBeenCalledWith({ feature: "ride", from: "r1" });
  });

  it("shows nothing when there are no suggestions or the request fails", async () => {
    matchingApi.getSuggestions.mockImplementation(() => Promise.reject(new Error("offline")));
    renderPanel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("Best matches")).not.toBeInTheDocument();
  });
});
