import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../app/theme-provider";
import { AboutPage, PaymentMethodsPage, PolicyPage, RateUsPage } from "./InfoPages";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/api")>()), api: apiMock }));

function show(element: React.ReactElement) {
  render(
    <ThemeProvider>
      <MemoryRouter>{element}</MemoryRouter>
    </ThemeProvider>,
  );
}

describe("information pages (proposal 5)", () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it("Rate Us sends the stars and the optional comment", async () => {
    apiMock.mockResolvedValue({ rating: { id: "r1" } });
    show(<RateUsPage />);
    const send = screen.getByRole("button", { name: "Send rating" });
    expect(send).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "4 stars" }));
    await userEvent.type(screen.getByRole("textbox"), "Works well");
    await userEvent.click(send);
    expect(apiMock).toHaveBeenCalledWith("/support/rate", { method: "POST", body: { rating: 4, comment: "Works well" } });
    expect(await screen.findByText(/Thank you!/)).toBeInTheDocument();
  });

  it("Policy, Payment Methods and About show their sections", () => {
    show(<PolicyPage />);
    for (const name of ["Terms of use", "Privacy", "Safety", "Cancellation and completion"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(screen.getByText(/email is never shown/)).toBeInTheDocument();
  });

  it("Payment Methods says UniGo never holds money, and About names the owner", () => {
    show(
      <>
        <PaymentMethodsPage />
        <AboutPage />
      </>,
    );
    expect(screen.getByText(/never takes or holds money/)).toBeInTheDocument();
    expect(screen.getByText(/owned by Mukit/)).toBeInTheDocument();
  });
});
