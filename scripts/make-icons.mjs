// Makes EVERY app icon from the one master design (the white 7 on the purple gradient, with the alarm-bell badge): npm run icons
// Needs the `sharp` package, which the project does not keep: run `npm i --no-save sharp` in the project root first (or set SHARP_FROM to a folder that has it).
// Writes: frontend/public/icons/sevenfriends.svg (the master), icon-192/512, icon-maskable-512, apple-touch-icon, favicon.ico, the copies in the Android and iPhone
// projects (their public folders), the Android launcher images, the iPhone app icon, the Windows app.ico and the MSIX assets.
// To change the design, change the constants below (BADGE) and run it again.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let sharp;
try {
  sharp = createRequire(process.env.SHARP_FROM ? join(process.env.SHARP_FROM, 'x.js') : join(root, 'x.js'))('sharp');
} catch {
  console.error('The package "sharp" is not installed (the project does not keep it). Install it once, then run this again:\n\n  npm i --no-save sharp\n  npm run icons\n');
  process.exit(1);
}

// ---- the design, in a 512 x 512 box -----------------------------------------------------------------------------------------------------
const GRADIENT = ['#4f46e5', '#7c3aed'];
const SEVEN = 'M150 140 H362 V190 L248 372 H184 L296 192 H150 Z';
/** The bell badge: a white circle with a purple bell, up in the lower right, clear of the rounded frame (the old place was too near the corner). */
const BADGE = { x: 388, y: 366, r: 70, bell: 3.5 };
const BELL = '<path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 003.4 0"/>';

const defs = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${GRADIENT[0]}"/><stop offset="1" stop-color="${GRADIENT[1]}"/></linearGradient></defs>`;
const seven = `<path d="${SEVEN}" fill="#fff" stroke="#fff" stroke-width="10" stroke-linejoin="round"/>`;
const badge = `<circle cx="${BADGE.x}" cy="${BADGE.y}" r="${BADGE.r}" fill="#fff"/><g fill="none" stroke="${GRADIENT[1]}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" transform="translate(${BADGE.x} ${BADGE.y}) scale(${BADGE.bell}) translate(-12 -12)">${BELL}</g>`;
const art = `${seven}${badge}`;

/** The picture as an svg text. `shape`: round (rounded square, see-through corners), square (full bleed), circle, none (no background: for the Android foreground).
 *  `scale`: the art is made smaller about the middle (safe zones). */
const svg = (size, { shape = 'round', scale = 1 } = {}) => {
  const bg = shape === 'none' ? '' : shape === 'circle' ? '<circle cx="256" cy="256" r="256" fill="url(#g)"/>' : shape === 'square' ? '<rect width="512" height="512" fill="url(#g)"/>' : '<rect width="512" height="512" rx="163" fill="url(#g)"/>';
  const g = scale === 1 ? art : `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${art}</g>`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">${defs}${bg}${g}</svg>`);
};
const png = (size, options) => sharp(svg(size, options), { density: 384 }).resize(size, size).png().toBuffer();

const put = (path, data) => {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  console.log('wrote', path);
};

/** An .ico with PNG pictures inside (Windows Vista and newer, every browser). */
const ico = async (sizes) => {
  const pics = await Promise.all(sizes.map((s) => png(s)));
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const at = 6 + 16 * i;
    head[at] = s >= 256 ? 0 : s;
    head[at + 1] = s >= 256 ? 0 : s;
    head.writeUInt16LE(1, at + 4); // planes
    head.writeUInt16LE(32, at + 6); // bits per pixel
    head.writeUInt32LE(pics[i].length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += pics[i].length;
  });
  return Buffer.concat([head, ...pics]);
};

// ---- the web app (and the copies the Android and iPhone projects keep of it) ----------------------------------------------------------
const masterSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Seven Friends">${defs}<rect width="512" height="512" rx="163" fill="url(#g)"/>${art}</svg>\n`;
const web = {
  'sevenfriends.svg': masterSvg,
  'icon-192.png': await png(192),
  'icon-512.png': await png(512),
  'icon-maskable-512.png': await png(512, { shape: 'square', scale: 0.78 }), // Android cuts it to any shape: the art stays in the middle 80 %
  'apple-touch-icon.png': await png(180, { shape: 'square', scale: 0.94 }), // the iPhone rounds the corners itself
};
const favicon = await ico([16, 32, 48]);
for (const dir of ['frontend/public', 'client-wrappers/android/app/src/main/assets/public', 'client-wrappers/ios/App/App/public']) {
  for (const [name, data] of Object.entries(web)) put(`${dir}/icons/${name}`, data);
  put(`${dir}/favicon.ico`, favicon);
}

// ---- Android: the launcher (legacy square and round, and the adaptive foreground that sits on the gradient of ic_launcher_gradient.xml) ----
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [name, k] of Object.entries(densities)) {
  const dir = `client-wrappers/android/app/src/main/res/mipmap-${name}`;
  put(`${dir}/ic_launcher.png`, await png(48 * k));
  put(`${dir}/ic_launcher_round.png`, await png(48 * k, { shape: 'circle', scale: 0.9 }));
  put(`${dir}/ic_launcher_foreground.png`, await png(108 * k, { shape: 'none', scale: 0.6 })); // the middle 66 of 108 dp are always seen
}

// ---- iPhone: one 1024 square, no see-through parts ----------------------------------------------------------------------------------
put('client-wrappers/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', await png(1024, { shape: 'square', scale: 0.94 }));

// ---- Windows: the app icon and the MSIX pictures ----------------------------------------------------------------------------------------
put('client-wrappers/windows/app.ico', await ico([16, 24, 32, 48, 64, 128, 256]));
put('client-wrappers/windows/msix/Assets/Square44x44Logo.png', await png(44));
put('client-wrappers/windows/msix/Assets/Square150x150Logo.png', await png(150));
put('client-wrappers/windows/msix/Assets/StoreLogo.png', await png(50));
put('client-wrappers/windows/msix/Assets/Wide310x150Logo.png', await sharp({ create: { width: 310, height: 150, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await png(150), left: 80, top: 0 }]).png().toBuffer());

console.log('done');
