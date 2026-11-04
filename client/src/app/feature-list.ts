import { Car, HandHelping, Repeat, UtensilsCrossed, type LucideIcon } from "lucide-react";
import manifest from "../assets/services/manifest.json";

// The service pictures are the project's own images (client/brand/services),
// built by client/scripts/build-brand-assets.mjs at the card's picture size on
// phones and desktop, each at 1x and 2x.
const files = import.meta.glob<string>("../assets/services/*.webp", { eager: true, import: "default" });

type FeatureKey = "ride" | "carpool" | "food" | "service";

export type ServicePicture = {
  src: string;
  srcSet: string;
  sizes: string;
  width: number;
  height: number;
};

function picture(key: FeatureKey): ServicePicture {
  const { widths, phone, desktop } = manifest[key];
  const url = (width: number) => files[`../assets/services/${key}-${width}.webp`];
  return {
    src: url(desktop.width),
    srcSet: widths.map((width) => `${url(width)} ${width}w`).join(", "),
    // Same breakpoint as the layout (768 px).
    sizes: `(min-width: 768px) ${desktop.width}px, ${phone.width}px`,
    width: desktop.width,
    height: desktop.height,
  };
}

// The four services, in the proposal's order. Text: features.<key>.name / .hint / .tag
export const featureList: { key: FeatureKey; icon: LucideIcon; picture: ServicePicture }[] = [
  { key: "ride", icon: Car, picture: picture("ride") },
  { key: "carpool", icon: Repeat, picture: picture("carpool") },
  { key: "food", icon: UtensilsCrossed, picture: picture("food") },
  { key: "service", icon: HandHelping, picture: picture("service") },
];
