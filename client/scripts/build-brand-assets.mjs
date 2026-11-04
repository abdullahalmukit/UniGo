// Builds every brand asset the client uses from the sources in client/brand.
// sharp is not a project dependency (A5a decision). To rebuild:
//
//   npm install --no-save sharp
//   node client/scripts/build-brand-assets.mjs
//
// Logo files (designs and colours unchanged):
//   Logo-UniGo01.png  full logo with tagline, white background
//   Logo-UniGo02.png  round "U" icon, already transparent
// Service card pictures: services/<ride|carpool|food|service>.png, the project's
// own images (designs unchanged).
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error("sharp is not installed. Run: npm install --no-save sharp");
  process.exit(1);
}

const client = process.env.CLIENT_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const brand = join(client, "brand");
const brandOut = join(client, "src", "assets", "brand");
const servicesOut = join(client, "src", "assets", "services");
const iconsOut = join(client, "public", "icons");
await rm(servicesOut, { recursive: true, force: true });
await Promise.all([brandOut, servicesOut, iconsOut].map((dir) => mkdir(dir, { recursive: true })));

// ---------------------------------------------------------------------------
// Full logo: make the white background transparent.
// The white "U" touches the white background where it meets the circle, so a
// plain "white to transparent" would cut holes in it. Instead the blue circle is
// located, everything inside it is kept exactly as it is, and only outside it is
// white turned into transparency (anti-aliased, so the black text stays crisp).
// ---------------------------------------------------------------------------

const full = await sharp(join(brand, "Logo-UniGo01.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = full.info;
const px = full.data;

const circle = fitLogoCircle(px, W, H);
console.log(`circle: centre (${circle.cx.toFixed(1)}, ${circle.cy.toFixed(1)}), radius ${circle.r.toFixed(1)}`);

const light = Buffer.alloc(px.length);
const dark = Buffer.alloc(px.length);
const plateRadius = circle.r * 1.06;

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    const d = Math.hypot(x - circle.cx, y - circle.cy);
    const inside = clamp(circle.r + 1.5 - d, 0, 1);

    // White to alpha: how far the pixel is from white, and its colour before
    // it was blended onto white.
    const a = Math.max(255 - r, 255 - g, 255 - b) / 255;
    const unblend = (c) => (a === 0 ? 0 : clamp(Math.round((c - 255 * (1 - a)) / a), 0, 255));
    const outA = a;
    const out = [unblend(r), unblend(g), unblend(b)];

    // Light version: transparent background.
    const alpha = inside === 1 ? 1 : Math.max(inside, outA);
    const rgb = inside > 0 ? [r, g, b] : out;
    light.set([...rgb, Math.round(alpha * 255)], i);

    // Dark version: the text turns white (as the wordmark does in dark mode) and
    // the circle sits on a white disc, so it looks as it does on a white page.
    const plate = clamp(plateRadius + 0.5 - d, 0, 1);
    const darkRgb = inside > 0 ? [r, g, b] : [255, 255, 255];
    const da = alpha + plate * (1 - alpha);
    const mix = (c) => (da === 0 ? 0 : Math.round((c * alpha + 255 * plate * (1 - alpha)) / da));
    dark.set([mix(darkRgb[0]), mix(darkRgb[1]), mix(darkRgb[2]), Math.round(da * 255)], i);
  }
}

const raw = { raw: { width: W, height: H, channels: 4 } };
await sharp(light, raw).trim({ threshold: 0 }).resize({ width: 960 }).png({ compressionLevel: 9 }).toFile(join(brandOut, "unigo-logo.png"));
await sharp(dark, raw).trim({ threshold: 0 }).resize({ width: 960 }).png({ compressionLevel: 9 }).toFile(join(brandOut, "unigo-logo-dark.png"));

// Wordmark: the "UNIGO" lettering only (no tagline), cropped from the full logo.
const word = findWordmark(light, W, H, circle);
await sharp(light, raw)
  .extract(word)
  .resize({ height: 96 })
  .png({ compressionLevel: 9 })
  .toFile(join(brandOut, "unigo-wordmark.png"));
console.log(`wordmark: ${word.width}x${word.height} at (${word.left}, ${word.top})`);

// ---------------------------------------------------------------------------
// Round icon: trim the transparent margin, then the navbar icon, favicon and
// PWA icons.
// ---------------------------------------------------------------------------

const icon = await sharp(join(brand, "Logo-UniGo02.png")).trim({ threshold: 0 }).png().toBuffer();
const iconAt = (size) => sharp(icon).resize(size, size, { fit: "contain", background: transparent() }).png();
const onWhite = async (size, share) => {
  const inner = Math.round(size * share);
  return sharp({ create: { width: size, height: size, channels: 4, background: "#FFFFFF" } })
    .composite([{ input: await iconAt(inner).toBuffer(), gravity: "centre" }])
    .png();
};

await iconAt(160).toFile(join(brandOut, "unigo-icon.png"));
await iconAt(32).toFile(join(iconsOut, "favicon-32.png"));
await iconAt(192).toFile(join(iconsOut, "icon-192.png"));
await iconAt(512).toFile(join(iconsOut, "icon-512.png"));
// Maskable: full-bleed background, icon inside the 80% safe zone.
await (await onWhite(512, 0.76)).toFile(join(iconsOut, "icon-maskable-512.png"));
// iOS fills transparency with black, so the touch icon gets a white background.
await (await onWhite(180, 0.86)).toFile(join(iconsOut, "apple-touch-icon.png"));

// ---------------------------------------------------------------------------
// Home service card pictures: WebP files sized for the card's picture box on
// phones and desktop, each at 1x and 2x, plus manifest.json for the srcset.
//
// The originals already have transparent backgrounds. Some also have holes the
// picture fully surrounds (the car's windows, the circle on the bag) that are
// transparent, so on a dark card they would turn dark. Large enclosed holes are
// filled with white, so each picture looks as it does on a white page in both
// themes. Open background and tiny gaps stay transparent.
// ---------------------------------------------------------------------------

// The card's picture box in CSS pixels (HomePage.module.css .featureArt).
const PICTURE_BOX = { phone: { width: 92, height: 72 }, desktop: { width: 128, height: 96 } };
const manifest = {};

for (const name of ["ride", "carpool", "food", "service"]) {
  const { data, info } = await sharp(join(brand, "services", `${name}.png`))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const filled = fillEnclosedHoles(data, info.width, info.height);
  const box = visibleBox(data, info.width, info.height);
  const picture = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract(box)
    .png()
    .toBuffer();

  const fit = ({ width, height }) => {
    const scale = Math.min(width / box.width, height / box.height);
    return { width: Math.round(box.width * scale), height: Math.round(box.height * scale) };
  };
  const phone = fit(PICTURE_BOX.phone);
  const desktop = fit(PICTURE_BOX.desktop);
  const widths = [...new Set([phone.width, desktop.width, phone.width * 2, desktop.width * 2])].sort((a, b) => a - b);

  for (const width of widths) {
    await sharp(picture)
      .resize({ width })
      .webp({ quality: 86, alphaQuality: 90, effort: 6 })
      .toFile(join(servicesOut, `${name}-${width}.webp`));
  }
  manifest[name] = { widths, phone, desktop };
  console.log(`${name}: ${box.width}x${box.height} visible, ${filled} hole pixels filled, widths ${widths.join("/")}`);
}

await writeFile(join(servicesOut, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log("Brand assets written.");

// ---------------------------------------------------------------------------

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function transparent() {
  return { r: 0, g: 0, b: 0, alpha: 0 };
}

// Fills transparent holes the picture fully surrounds, if they are at least
// 0.2% of the image (so gaps such as those between fries stay as they are), by
// blending them onto white. Returns the number of pixels changed.
function fillEnclosedHoles(data, width, height) {
  const see = (p) => data[p * 4 + 3] < 250;
  const outside = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);

  // Everything see-through that is reachable from the image border is background.
  let head = 0;
  let tail = 0;
  const push = (p) => {
    if (!outside[p] && see(p)) {
      outside[p] = 1;
      queue[tail++] = p;
    }
  };
  for (let x = 0; x < width; x++) push(x), push((height - 1) * width + x);
  for (let y = 0; y < height; y++) push(y * width), push(y * width + width - 1);
  while (head < tail) {
    const p = queue[head++];
    const x = p % width;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (p >= width) push(p - width);
    if (p < width * (height - 1)) push(p + width);
  }

  // The rest of the see-through pixels form enclosed holes.
  const seen = new Uint8Array(width * height);
  const minimum = width * height * 0.002;
  let changed = 0;
  for (let start = 0; start < width * height; start++) {
    if (seen[start] || outside[start] || !see(start)) continue;
    const hole = [];
    seen[start] = 1;
    hole.push(start);
    for (let k = 0; k < hole.length; k++) {
      const p = hole[k];
      const x = p % width;
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
        if (q >= 0 && q < width * height && !seen[q] && !outside[q] && see(q)) {
          seen[q] = 1;
          hole.push(q);
        }
      }
    }
    if (hole.length < minimum) continue;
    for (const p of hole) {
      const i = p * 4;
      const a = data[i + 3] / 255;
      for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * a + 255 * (1 - a));
      data[i + 3] = 255;
    }
    changed += hole.length;
  }
  return changed;
}

// The smallest box around every visible pixel.
function visibleBox(data, width, height) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

// Fits a circle to the outer edge of the blue disc: the left- and right-most
// blue pixel of each row, refitted after dropping points where the white "U"
// cuts the edge.
function fitLogoCircle(data, width, height) {
  const isBlue = (i) => data[i + 2] > 90 && data[i + 2] > data[i] + 40 && data[i] < 200;
  let points = [];
  for (let y = 0; y < height; y++) {
    let min = -1;
    let max = -1;
    for (let x = 0; x < width * 0.45; x++) {
      if (isBlue((y * width + x) * 4)) {
        if (min < 0) min = x;
        max = x;
      }
    }
    if (min >= 0) points.push([min, y], [max, y]);
  }

  let fit;
  for (let round = 0; round < 4; round++) {
    fit = fitCircle(points);
    points = points.filter(([x, y]) => Math.abs(Math.hypot(x - fit.cx, y - fit.cy) - fit.r) < 3);
  }
  return fit;
}

// Least-squares circle through points (Kasa method).
function fitCircle(points) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  for (const [x, y] of points) {
    const z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z;
  }
  const n = points.length;
  // Solve [sxx sxy sx; sxy syy sy; sx sy n] [D E F] = -[sxz syz sz]
  const m = [
    [sxx, sxy, sx, -sxz],
    [sxy, syy, sy, -syz],
    [sx, sy, n, -sz],
  ];
  for (let c = 0; c < 3; c++) {
    const p = m.slice(c).reduce((best, row, k) => (Math.abs(row[c]) > Math.abs(m[best][c]) ? c + k : best), c);
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
    }
  }
  const [D, E, F] = [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
  const cx = -D / 2;
  const cy = -E / 2;
  return { cx, cy, r: Math.sqrt(cx * cx + cy * cy - F) };
}

// The first band of rows with black lettering to the right of the circle is
// "UNIGO"; the band below it is the tagline. Only dark pixels count as ink, so
// the blue edge of the circle is never included.
function findWordmark(data, width, height, { cx, r }) {
  const startX = Math.ceil(cx + r);
  const isInk = (x, y) => {
    const i = (y * width + x) * 4;
    return data[i + 3] > 24 && data[i] < 90 && data[i + 1] < 90 && data[i + 2] < 90;
  };
  const rowHasInk = (y) => {
    for (let x = startX; x < width; x++) if (isInk(x, y)) return true;
    return false;
  };
  let top = 0;
  while (top < height && !rowHasInk(top)) top++;
  let bottom = top;
  while (bottom < height && rowHasInk(bottom)) bottom++;

  let left = width;
  let right = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = startX; x < width; x++) {
      if (isInk(x, y)) {
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
  }
  return { left, top, width: right - left + 1, height: bottom - top };
}
