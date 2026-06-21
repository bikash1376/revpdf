/**
 * One-off: generate Android adaptive + legacy app icons from the brand logo.
 *
 * Source is the landscape "RevPdf" wordmark (assets/revpdf-png.png). We crop the
 * red "Rev" document badge and compose it into square 1024x1024 icons:
 *   - icon.png                    main/iOS icon: red badge on white, full bleed
 *   - android-icon-foreground.png adaptive foreground: red badge, safe-zone padded
 *   - android-icon-background.png adaptive background: solid white
 *   - android-icon-monochrome.png themed-icon layer: badge silhouette (Rev cut out)
 *
 * Run: node ./scripts/gen-icons.mjs   (needs `sharp`)
 */
import sharp from 'sharp';

const SRC = 'assets/revpdf-png.png';
const OUT = 'assets/images';
const SIZE = 1024;
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

// Red "Rev" badge bounding box in the 1600x900 source (+ small pad for the fold).
const CROP = { left: 486, top: 341, width: 340, height: 219 };

function blank(extra = {}) {
  return sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 }, ...extra },
  }).png();
}

// Scale the badge to `frac` of the canvas width, return { buf, w, h }.
async function badge(frac) {
  const targetW = Math.round(SIZE * frac);
  const buf = await sharp(SRC)
    .extract(CROP)
    .resize({ width: targetW })
    .png()
    .toBuffer();
  const meta = await sharp(buf).metadata();
  return { buf, w: meta.width, h: meta.height };
}

function center(w, h) {
  return { left: Math.round((SIZE - w) / 2), top: Math.round((SIZE - h) / 2) };
}

async function makeIcon() {
  const { buf, w, h } = await badge(0.7); // a bit larger; iOS rounds the corners
  const { left, top } = center(w, h);
  await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: WHITE } })
    .composite([{ input: buf, left, top }])
    .flatten({ background: WHITE })
    .png()
    .toFile(`${OUT}/icon.png`);
}

async function makeForeground() {
  const { buf, w, h } = await badge(0.6); // keep inside the adaptive safe zone (~66%)
  const { left, top } = center(w, h);
  await blank().composite([{ input: buf, left, top }]).toFile(`${OUT}/android-icon-foreground.png`);
}

async function makeBackground() {
  await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: WHITE } })
    .png()
    .toFile(`${OUT}/android-icon-background.png`);
}

async function makeMonochrome() {
  // Build a silhouette from the crop: opaque white where the badge is red,
  // transparent where the white "Rev" letters (and outside) are — so the letters
  // read as cut-outs. The system tints this single-color layer.
  const { data, info } = await sharp(SRC)
    .extract(CROP)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const out = Buffer.alloc(w * h * 4, 0);
  for (let i = 0, j = 0; i < data.length; i += c, j += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    const reddish = a > 40 && r > 150 && r - g > 45 && b < 160;
    if (reddish) {
      out[j] = 255; out[j + 1] = 255; out[j + 2] = 255; out[j + 3] = 255;
    }
  }
  const targetW = Math.round(SIZE * 0.6);
  const silo = await sharp(out, { raw: { width: w, height: h, channels: 4 } })
    .resize({ width: targetW })
    .png()
    .toBuffer();
  const meta = await sharp(silo).metadata();
  const { left, top } = center(meta.width, meta.height);
  await blank().composite([{ input: silo, left, top }]).toFile(`${OUT}/android-icon-monochrome.png`);
}

await makeBackground();
await makeIcon();
await makeForeground();
await makeMonochrome();
console.log('Generated icon.png + android-icon-{foreground,background,monochrome}.png at', OUT);
