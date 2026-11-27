// Renders extensions/<name>/icon.svg into static/icons/icon-{16,32,48,128}.png.
// The 128 px store icon follows Google's guideline: 96 px of artwork with
// 16 px of transparent padding on each side.
import sharp from 'sharp';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extensionFromArgs } from './lib.mjs';

const ext = extensionFromArgs();
const svg = readFileSync(join(ext.dir, 'icon.svg'));
const out = join(ext.static, 'icons');
mkdirSync(out, { recursive: true });

const render = (size) =>
  sharp(svg, { density: Math.max(72, (72 * size * 4) / 512) }).resize(size, size);

for (const size of [16, 32, 48]) {
  await render(size).png().toFile(join(out, `icon-${size}.png`));
}
await render(96)
  .extend({
    top: 16,
    bottom: 16,
    left: 16,
    right: 16,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toFile(join(out, 'icon-128.png'));
console.log(`Icons written to ${out}`);
