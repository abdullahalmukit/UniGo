import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { Footer } from "../../app/layout/Footer";
import { ThemeProvider } from "../../app/theme-provider";
import { DevelopersPage } from "./DevelopersPage";

function show(element: React.ReactElement) {
  render(
    <ThemeProvider>
      <MemoryRouter>{element}</MemoryRouter>
    </ThemeProvider>,
  );
}

describe("Meet the developers", () => {
  it("shows the three developers with photo, role, email, GitHub and portfolio where there is one", () => {
    show(<DevelopersPage />);
    const cards = screen.getAllByRole("listitem").filter((item) => within(item).queryByRole("heading"));
    expect(cards.map((card) => within(card).getByRole("heading").textContent)).toEqual(["Md. Abdul Mukit", "Shawon Sarkar", "Mohammad Alif"]);

    const mukit = within(cards[0]!);
    expect(mukit.getByRole("img", { name: "Photo of Md. Abdul Mukit" })).toBeInTheDocument();
    expect(mukit.getByText("Project owner · Developer")).toBeInTheDocument();
    expect(mukit.getByRole("link", { name: /abdullahalmukit287@gmail.com/ })).toHaveAttribute("href", "mailto:abdullahalmukit287@gmail.com");
    expect(mukit.getByRole("link", { name: /@abdullahalmukit/ })).toHaveAttribute("href", "https://github.com/abdullahalmukit");
    expect(mukit.getByRole("link", { name: /mukit\.swe\.bd/ })).toHaveAttribute("href", "https://mukit.swe.bd/");

    const shawon = within(cards[1]!);
    expect(shawon.getByRole("link", { name: /@Shawon014000/ })).toHaveAttribute("href", "https://github.com/Shawon014000");
    expect(shawon.queryByText("Portfolio")).toBeNull();
    const alif = within(cards[2]!);
    expect(alif.getByRole("link", { name: /mohammadalif8786@gmail.com/ })).toHaveAttribute("href", "mailto:mohammadalif8786@gmail.com");
    expect(alif.getByRole("link", { name: /@MohammadAlif0/ })).toHaveAttribute("href", "https://github.com/MohammadAlif0");

    // External links open safely in a new tab
    for (const link of screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("https://"))) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
    }
  });
});

describe("footer", () => {
  it("links the services, quick links, account and help pages, the team and the legal pages", () => {
    show(<Footer />);
    const nav = within(screen.getByRole("navigation", { name: "Footer" }));
    for (const heading of ["Services", "Quick links", "Account", "Help & company"]) {
      expect(nav.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    for (const [name, href] of [
      ["Ride Sharing", "/ride"],
      ["Carpool", "/carpool"],
      ["Food Delivery", "/food"],
      ["Uni Service", "/service"],
      ["Upcoming", "/upcoming"],
      ["Profile", "/account/profile"],
      ["Payment methods", "/account/payment-methods"],
      ["Support", "/account/support"],
      ["Policy", "/policy"],
      ["Meet the developers", "/developers"],
    ]) {
      expect(nav.getByRole("link", { name })).toHaveAttribute("href", href);
    }
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/policy#policy-privacy");
    expect(screen.getByText(`© ${new Date().getFullYear()} UniGo. All rights reserved.`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Md. Abdul Mukit on GitHub" })).toHaveAttribute("href", "https://github.com/abdullahalmukit");
  });
});
