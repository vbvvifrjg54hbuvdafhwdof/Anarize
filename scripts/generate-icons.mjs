import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const publicDir = path.resolve(process.cwd(), 'public');
const iconSvg = fs.readFileSync(path.join(publicDir, 'icon.svg'));
const maskableSvg = fs.readFileSync(path.join(publicDir, 'icon-maskable.svg'));

async function buildPngs() {
  // For apple-touch-icon (180x180), render square full-bleed navy background so iOS applies its own squircle mask cleanly
  await sharp(maskableSvg)
    .resize(180, 180)
    .png()
    .toFile(path.join(publicDir, 'apple-touch-icon.png'));

  await sharp(iconSvg)
    .resize(192, 192)
    .png()
    .toFile(path.join(publicDir, 'pwa-192x192.png'));

  await sharp(iconSvg)
    .resize(512, 512)
    .png()
    .toFile(path.join(publicDir, 'pwa-512x512.png'));

  await sharp(maskableSvg)
    .resize(512, 512)
    .png()
    .toFile(path.join(publicDir, 'pwa-maskable-512x512.png'));

  const png32 = await sharp(iconSvg).resize(32, 32).png().toBuffer();
  await sharp(png32).toFile(path.join(publicDir, 'favicon-32x32.png'));

  // Minimal valid single-image ICO wrapping 32x32 PNG
  const icoHeader = Buffer.alloc(22);
  icoHeader.writeUInt16LE(0, 0); // reserved
  icoHeader.writeUInt16LE(1, 2); // type = 1 (icon)
  icoHeader.writeUInt16LE(1, 4); // image count = 1
  icoHeader.writeUInt8(32, 6); // width
  icoHeader.writeUInt8(32, 7); // height
  icoHeader.writeUInt8(0, 8); // color palette
  icoHeader.writeUInt8(0, 9); // reserved
  icoHeader.writeUInt16LE(1, 10); // color planes
  icoHeader.writeUInt16LE(32, 12); // bpp
  icoHeader.writeUInt32LE(png32.length, 14); // image size
  icoHeader.writeUInt32LE(22, 18); // image offset
  fs.writeFileSync(path.join(publicDir, 'favicon.ico'), Buffer.concat([icoHeader, png32]));

  console.log('Generated PWA PNG icons and favicon.ico in public/');
}

buildPngs().catch((err) => {
  console.error(err);
  process.exit(1);
});
