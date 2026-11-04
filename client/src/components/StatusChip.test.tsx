import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusChip, type ActivityStatus } from "./StatusChip";

describe("StatusChip", () => {
  // CLAUDE.md section 9: status chip colours.
  it.each<[ActivityStatus, string, string]>([
    ["COMPLETED", "green", "Completed"],
    ["OPEN", "amber", "Open"],
    ["ACCEPTED", "indigo", "Accepted"],
    ["IN_PROGRESS", "purple", "In progress"],
    ["CANCELLED", "red", "Cancelled"],
    ["DISPUTED", "red", "Disputed"],
    ["EXPIRED", "grey", "Expired"],
    ["NOT_MARKED", "grey", "Not marked"],
  ])("shows %s in %s", (status, tone, label) => {
    render(<StatusChip status={status} />);
    const chip = screen.getByText(label);
    expect(chip).toHaveAttribute("data-tone", tone);
    expect(chip).toHaveClass(tone);
  });
});
