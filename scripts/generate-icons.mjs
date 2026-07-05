/**
 * Generates all app icons from the devil head logo (public/logo-hub.png).
 *
 * Outputs:
 *   public/icons/icon-{192,512}.png           — manifest icons (purpose: any)
 *   public/icons/icon-maskable-{192,512}.png  — manifest icons (purpose: maskable,
 *                                               logo shrunk into the safe zone so
 *                                               Android's circle crop doesn't clip it)
 *   src/app/apple-icon.png                    — iOS home-screen icon (180x180)
 *   src/app/icon.png                          — browser-tab favicon (512x512)
 *   src/app/favicon.ico                       — legacy /favicon.ico (PNG-in-ICO, 16+32+48)
 *
 * Run: node scripts/generate-icons.mjs
 * Uses sharp from node_modules (bundled with Next.js) — no extra install needed.
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'public', 'logo-hub.png');
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

/** Render the logo centered on a white square canvas. scale = fraction of the canvas the logo may fill. */
async function makeIcon(size, scale) {
  const inner = Math.round(size * scale);
  const logo = await sharp(SRC).resize(inner, inner, { fit: 'inside' }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: WHITE } })
    .composite([{ input: logo, gravity: 'center' }])
    .flatten({ background: WHITE })
    .png()
    .toBuffer();
}

/** Pack PNG buffers into a single .ico file (PNG-in-ICO, supported by all modern browsers). */
function packIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach(({ size, buf }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o); // width (0 = 256)
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1); // height
    dir.writeUInt8(0, o + 2); // palette
    dir.writeUInt8(0, o + 3); // reserved
    dir.writeUInt16LE(1, o + 4); // color planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(buf.length, o + 8); // data size
    dir.writeUInt32LE(offset, o + 12); // data offset
    offset += buf.length;
  });

  return Buffer.concat([header, dir, ...entries.map(e => e.buf)]);
}

async function main() {
  const iconsDir = path.join(root, 'public', 'icons');
  await mkdir(iconsDir, { recursive: true });

  // Manifest icons — logo fills most of the canvas.
  for (const size of [192, 512]) {
    await writeFile(path.join(iconsDir, `icon-${size}.png`), await makeIcon(size, 0.92));
  }
  // Maskable variants — logo confined to the ~80%-diameter safe zone.
  for (const size of [192, 512]) {
    await writeFile(path.join(iconsDir, `icon-maskable-${size}.png`), await makeIcon(size, 0.68));
  }

  await writeFile(path.join(root, 'src', 'app', 'apple-icon.png'), await makeIcon(180, 0.92));
  await writeFile(path.join(root, 'src', 'app', 'icon.png'), await makeIcon(512, 0.92));

  const icoEntries = [];
  for (const size of [16, 32, 48]) {
    icoEntries.push({ size, buf: await makeIcon(size, 1) });
  }
  await writeFile(path.join(root, 'src', 'app', 'favicon.ico'), packIco(icoEntries));

  console.log('Icons generated: public/icons/*, src/app/{icon.png,apple-icon.png,favicon.ico}');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
