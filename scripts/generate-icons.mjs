// Generate PWA icon PNGs from public/favicon.svg using sharp.
// Runs as a `prebuild` step so deploys always have fresh icons.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const svgPath = resolve(root, 'public/favicon.svg');
const outDir = resolve(root, 'public/icons');

const svg = await readFile(svgPath);
await mkdir(outDir, { recursive: true });

for (const size of [192, 512]) {
  const out = resolve(outDir, `icon-${size}.png`);
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(out);
  console.log(`wrote ${out}`);
}

// Also write a precomposed apple-touch-icon
const appleOut = resolve(root, 'public/apple-touch-icon.png');
await sharp(svg, { density: 384 }).resize(180, 180).png().toFile(appleOut);
console.log(`wrote ${appleOut}`);

// Generate placeholder parchment texture (faint dot pattern in SVG)
const textureDir = resolve(root, 'public/textures');
await mkdir(textureDir, { recursive: true });
const texturePath = resolve(textureDir, 'parchment.svg');
const textureSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
  <defs>
    <pattern id="p" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
      <circle cx="20" cy="20" r="0.5" fill="#B5895A" opacity="0.15"/>
      <circle cx="5" cy="35" r="0.4" fill="#7A4A2E" opacity="0.1"/>
      <circle cx="35" cy="8" r="0.3" fill="#3B2A1E" opacity="0.08"/>
    </pattern>
  </defs>
  <rect width="200" height="200" fill="url(#p)"/>
</svg>`;
await writeFile(texturePath, textureSvg);
console.log(`wrote ${texturePath}`);
