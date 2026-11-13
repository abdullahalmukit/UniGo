import { describe, expect, it } from "vitest";
import {
  bannerCreateSchema,
  bannerUpdateSchema,
  promoCreateSchema,
  promoUpdateSchema,
  spotlightCreateSchema,
  spotlightUpdateSchema,
} from "../../src/modules/content/content.routes.js";

describe("Content Validation Schemas (B8)", () => {
  describe("Spotlight Schema", () => {
    it("accepts valid image spotlight item", () => {
      const parsed = spotlightCreateSchema.parse({
        title: "Welcome to Campus",
        mediaType: "IMAGE",
        mediaUrl: "https://example.com/spotlight.jpg",
        linkUrl: "https://example.com/events",
        linkLabel: "View Events",
        sortOrder: 1,
        isActive: true,
      });
      expect(parsed.title).toBe("Welcome to Campus");
      expect(parsed.mediaType).toBe("IMAGE");
      expect(parsed.mediaUrl).toBe("https://example.com/spotlight.jpg");
    });

    it("accepts video spotlight item with minimal fields", () => {
      const parsed = spotlightCreateSchema.parse({
        mediaType: "VIDEO",
        mediaUrl: "https://example.com/promo.mp4",
      });
      expect(parsed.mediaType).toBe("VIDEO");
      expect(parsed.title).toBeUndefined();
    });

    it("rejects invalid URL or mediaType", () => {
      expect(() =>
        spotlightCreateSchema.parse({
          mediaType: "AUDIO" as any,
          mediaUrl: "not-a-url",
        }),
      ).toThrow();
    });

    it("allows partial update in spotlightUpdateSchema", () => {
      const parsed = spotlightUpdateSchema.parse({
        title: "Updated Title",
        isActive: false,
      });
      expect(parsed.title).toBe("Updated Title");
      expect(parsed.isActive).toBe(false);
    });
  });

  describe("Promo Schema", () => {
    it("accepts valid promo with all fields", () => {
      const parsed = promoCreateSchema.parse({
        title: "50% Off First Delivery",
        description: "Use code at checkout for half-price delivery.",
        imageUrl: "https://example.com/banner.png",
        promoCode: "HALFOFF",
        startsAt: "2026-11-01T00:00:00.000Z",
        endsAt: "2026-12-01T00:00:00.000Z",
        isActive: true,
      });
      expect(parsed.title).toBe("50% Off First Delivery");
      expect(parsed.promoCode).toBe("HALFOFF");
      expect(parsed.startsAt).toBeInstanceOf(Date);
      expect(parsed.endsAt).toBeInstanceOf(Date);
    });

    it("rejects empty title or missing dates", () => {
      expect(() =>
        promoCreateSchema.parse({
          title: "",
          startsAt: "2026-11-01",
        }),
      ).toThrow();
    });

    it("allows partial update in promoUpdateSchema", () => {
      const parsed = promoUpdateSchema.parse({
        promoCode: "NEWCODE",
      });
      expect(parsed.promoCode).toBe("NEWCODE");
    });
  });

  describe("Banner Schema", () => {
    it("accepts valid banner", () => {
      const parsed = bannerCreateSchema.parse({
        title: "Mid-Term Ride Special",
        imageUrl: "https://example.com/ride-special.jpg",
        linkUrl: "https://example.com/rides",
        startsAt: "2026-11-10T00:00:00.000Z",
        endsAt: "2026-11-20T00:00:00.000Z",
        sortOrder: 0,
      });
      expect(parsed.title).toBe("Mid-Term Ride Special");
      expect(parsed.imageUrl).toBe("https://example.com/ride-special.jpg");
    });

    it("accepts in-app relative linkUrl like /services", () => {
      const parsed = bannerCreateSchema.parse({
        title: "Mid-Term Ride Special",
        imageUrl: "https://example.com/ride-special.jpg",
        linkUrl: "/services",
        startsAt: "2026-11-10T00:00:00.000Z",
        endsAt: "2026-11-20T00:00:00.000Z",
        sortOrder: 0,
      });
      expect(parsed.linkUrl).toBe("/services");
    });

    it("rejects empty title or missing startsAt", () => {
      expect(() =>
        bannerCreateSchema.parse({
          title: "",
          imageUrl: "https://example.com/pic.jpg",
          startsAt: "2026-11-10",
        }),
      ).toThrow();
    });

    it("allows partial update in bannerUpdateSchema", () => {
      const parsed = bannerUpdateSchema.parse({
        sortOrder: 5,
        isActive: false,
      });
      expect(parsed.sortOrder).toBe(5);
      expect(parsed.isActive).toBe(false);
    });
  });
});

