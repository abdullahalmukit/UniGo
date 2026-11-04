import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { IconLink } from "./IconLink";
import { notificationsLink } from "./nav-items";

function renderLink(unread?: number) {
  render(
    <MemoryRouter>
      <IconLink item={notificationsLink} unread={unread} />
    </MemoryRouter>,
  );
  return screen.getByRole("link");
}

describe("IconLink", () => {
  it("has an aria-label and a tooltip, and no badge when nothing is unread", () => {
    const link = renderLink();

    expect(link).toHaveAccessibleName("Notifications");
    expect(link).toHaveAttribute("data-tooltip", "Notifications");
    expect(link.textContent).toBe("");
  });

  it("shows an unread badge and says the count in its name", () => {
    const link = renderLink(3);

    expect(link).toHaveAccessibleName("Notifications, 3 unread");
    expect(link).toHaveTextContent("3");
  });

  it("caps the badge at 99+", () => {
    expect(renderLink(250)).toHaveTextContent("99+");
  });
});
