import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Tests run from the client folder (npm test -w client).
const css = readFileSync(join(process.cwd(), "src", "styles", "tokens.css"), "utf8");

// Checks every text/background pair in tokens.css against WCAG 2.x AA:
// 4.5:1 for text, 3:1 for UI parts such as the focus ring.

function tokens(selector: string) {
  const block = css.slice(css.indexOf(`${selector} {`)).match(/\{([^}]*)\}/)![1];
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)].map(([, name, value]) => [name, value]));
}

const light = tokens(":root");
const dark = { ...light, ...tokens('[data-theme="dark"]') };

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [text, background, minimum ratio]
const pairs: [string, string, number][] = [
  ["--color-text", "--color-bg", 4.5],
  ["--color-text", "--color-surface", 4.5],
  ["--color-text", "--color-surface-muted", 4.5],
  ["--color-text-muted", "--color-bg", 4.5],
  ["--color-text-muted", "--color-surface", 4.5],
  ["--color-text-muted", "--color-surface-muted", 4.5],
  ["--color-accent", "--color-bg", 4.5],
  ["--color-accent", "--color-surface", 4.5],
  ["--color-accent", "--color-accent-soft", 4.5],
  ["--color-on-accent", "--color-accent", 4.5],
  ["--color-on-badge", "--color-badge", 4.5],
  ["--color-focus", "--color-surface", 3],
  ...(["green", "amber", "indigo", "purple", "red", "grey"] as const).map(
    (tone): [string, string, number] => [`--status-${tone}-fg`, `--status-${tone}-bg`, 4.5],
  ),
];

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme meets WCAG AA", (_theme, values) => {
  it.each(pairs)("%s on %s", (text, background, minimum) => {
    expect(values[text], text).toBeDefined();
    expect(values[background], background).toBeDefined();
    expect(contrast(values[text], values[background])).toBeGreaterThanOrEqual(minimum);
  });
});

describe("palette", () => {
  it("uses the agreed brand colours", () => {
    expect(light).toMatchObject({
      "--color-bg": "#f4f8fd",
      "--color-surface": "#ffffff",
      "--color-accent": "#0a6fd6",
      "--color-text": "#0f1b2d",
    });
    expect(dark).toMatchObject({
      "--color-bg": "#0b1220",
      "--color-surface": "#131c2e",
      "--color-accent": "#4da3ff",
      "--color-text": "#e6edf7",
    });
  });
});
