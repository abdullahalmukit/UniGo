import { describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { api } from "./helpers.js";

describe("GET /api/universities", () => {
  it("lists only active universities, by name, without needing a login", async () => {
    await prisma.university.createMany({
      data: [
        { name: "Zeta University", shortName: "ZU" },
        { name: "Alpha University", shortName: "AU" },
        { name: "Closed University", isActive: false },
      ],
    });

    const response = await api().get("/api/universities");

    expect(response.status).toBe(200);
    expect(response.body.universities.map((u: { name: string }) => u.name)).toEqual([
      "Alpha University",
      "Zeta University",
    ]);
    expect(Object.keys(response.body.universities[0]).sort()).toEqual(["id", "name", "shortName"]);
  });
});
