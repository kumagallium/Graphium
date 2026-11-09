/** 承認済みの透過原稿からブランド画像を再生成する。輪郭の描き直しは行わない。 */
import { chromium } from 'playwright';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const tauriPackagePath = require.resolve('@tauri-apps/cli/package.json');
const tauriPackage = JSON.parse(await readFile(tauriPackagePath, 'utf8'));
const tauriCli = resolve(dirname(tauriPackagePath), tauriPackage.bin.tauri);
const green = '#286149';
const charcoal = '#27332F';
const source = async (name) => `data:image/png;base64,${(await readFile(resolve(root, 'assets/brand', name))).toString('base64')}`;
const sources = { mark: await source('mark-source.png'), wordmark: await source('wordmark-source.png') };
const browser = await chromium.launch({ headless: true });
let generated;
try {
  const page = await browser.newPage();
  generated = await page.evaluate(async ({ sources, green, charcoal }) => {
    const canvas = (width, height = width) => {
      const c = document.createElement('canvas');
      c.width = width; c.height = height;
      return c;
    };
    const inspect = (c) => {
      const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let transparent = 0, opaque = 0, black = 0;
      let left = c.width, top = c.height, right = -1, bottom = -1;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] === 0) transparent++;
        else {
          const x = (i / 4) % c.width, y = Math.floor(i / 4 / c.width);
          // 生成原稿のアルファ 1/255 の散在ノイズは余白判定からだけ除外する。
          if (pixels[i + 3] >= 2) {
            left = Math.min(left, x); right = Math.max(right, x);
            top = Math.min(top, y); bottom = Math.max(bottom, y);
          }
          if (pixels[i + 3] === 255) opaque++;
          if (pixels[i + 3] >= 16 && pixels[i] === 0 && pixels[i + 1] === 0 && pixels[i + 2] === 0) black++;
        }
      }
      return { width: c.width, height: c.height, transparent, opaque, black, bounds: [left, top, right, bottom] };
    };
    const load = async (url, color) => {
      const img = new Image(); img.src = url; await img.decode();
      const original = canvas(img.width, img.height);
      original.getContext('2d').drawImage(img, 0, 0);
      const stats = inspect(original);
      if (!stats.transparent || stats.black > 0) throw new Error(`Source must be transparent without visible black pixels: ${JSON.stringify(stats)}`);
      const [left, top, right, bottom] = stats.bounds;
      const trimmed = canvas(right - left + 1, bottom - top + 1);
      const ctx = trimmed.getContext('2d');
      ctx.drawImage(original, left, top, trimmed.width, trimmed.height, 0, 0, trimmed.width, trimmed.height);
      // アルファ輪郭はそのままに、色だけを統一する。
      ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = color; ctx.fillRect(0, 0, trimmed.width, trimmed.height);
      return { image: trimmed, stats };
    };
    const mark = await load(sources.mark, green);
    const wordmark = await load(sources.wordmark, charcoal);
    const tint = (image, color) => {
      const c = canvas(image.width, image.height), ctx = c.getContext('2d');
      ctx.drawImage(image, 0, 0); ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = color; ctx.fillRect(0, 0, c.width, c.height); return c;
    };
    const whiteMark = tint(mark.image, '#FFFFFF');
    const fit = (ctx, image, x, y, width, height = width) => {
      const scale = Math.min(width / image.width, height / image.height);
      const w = image.width * scale, h = image.height * scale;
      ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
    };
    const out = {};
    const save = (name, c) => { out[name] = { png: c.toDataURL('image/png').split(',')[1], stats: inspect(c) }; };
    for (const [name, image] of [['logo', mark.image], ['logo-light', whiteMark]]) {
      const c = canvas(512); fit(c.getContext('2d'), image, 31, 31, 450); save(`public/${name}.png`, c);
    }
    const text = canvas(900, Math.round(wordmark.image.height * 900 / wordmark.image.width));
    text.getContext('2d').drawImage(wordmark.image, 0, 0, text.width, text.height);
    save('public/logo-text.png', text);
    const icon = (size, style) => {
      const c = canvas(size), ctx = c.getContext('2d');
      ctx.fillStyle = green;
      const inset = style === 'app' ? size * .08 : 0;
      const side = size - inset * 2;
      if (style === 'maskable' || style === 'apple') ctx.fillRect(0, 0, size, size);
      else { ctx.beginPath(); ctx.roundRect(inset, inset, side, side, side * .18); ctx.fill(); }
      const fraction = { app: .60, favicon: .72, maskable: .55, apple: .70 }[style];
      fit(ctx, whiteMark, size * (1 - fraction) / 2, size * (1 - fraction) / 2, size * fraction);
      return c;
    };
    save('public/app-icon.png', icon(1024, 'app'));
    for (const size of [192, 512]) save(`public/pwa-${size}.png`, icon(size, 'app'));
    save('public/pwa-maskable-512.png', icon(512, 'maskable'));
    save('public/apple-touch-icon.png', icon(180, 'apple'));
    for (const size of [16, 32, 48, 64, 128, 256]) save(`favicon-${size}`, icon(size, 'favicon'));
    const social = canvas(1200, 630), ctx = social.getContext('2d');
    ctx.fillStyle = '#FAFAF7'; ctx.fillRect(0, 0, 1200, 630);
    const markSize = 220, gap = 45, textWidth = 750;
    const start = (1200 - markSize - gap - textWidth) / 2;
    fit(ctx, mark.image, start, (630 - markSize) / 2, markSize);
    fit(ctx, wordmark.image, start + markSize + gap, 205, textWidth, 220);
    save('public/brand/social-card.png', social);
    return { sources: { mark: mark.stats, wordmark: wordmark.stats }, files: out };
  }, { sources, green, charcoal });
} finally {
  await browser.close();
}

for (const [name, asset] of Object.entries(generated.files)) {
  if (name.startsWith('favicon-')) continue;
  const target = resolve(root, name);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, Buffer.from(asset.png, 'base64'));
}
// ICO 内には各解像度の PNG フレームを格納する。
const sizes = [16, 32, 48, 64, 128, 256];
const frames = sizes.map((size) => Buffer.from(generated.files[`favicon-${size}`].png, 'base64'));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, index) => {
  const entry = 6 + index * 16;
  header[entry] = size === 256 ? 0 : size; header[entry + 1] = header[entry];
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frames[index].length, entry + 8); header.writeUInt32LE(offset, entry + 12);
  offset += frames[index].length;
});
await writeFile(resolve(root, 'public/favicon.ico'), Buffer.concat([header, ...frames]));
for (const name of ['logo.png', 'logo-light.png', 'apple-touch-icon.png', 'favicon.ico']) {
  await copyFile(resolve(root, 'public', name), resolve(root, 'manual/public', name));
}
for (const size of [16, 32, 48, 128]) {
  await writeFile(resolve(root, `extensions/chrome/icons/icon-${size}.png`), Buffer.from(generated.files[`favicon-${size}`].png, 'base64'));
}
const temp = await mkdtemp(resolve(tmpdir(), 'graphium-brand-'));
try {
  execFileSync(process.execPath, [tauriCli, 'icon', resolve(root, 'public/app-icon.png'), '--output', temp], { cwd: root, stdio: 'inherit' });
  for (const name of ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.ico', 'icon.icns']) {
    await copyFile(resolve(temp, name), resolve(root, 'src-tauri/icons', name));
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
console.log(JSON.stringify({ sources: generated.sources, assets: Object.fromEntries(Object.entries(generated.files).map(([name, asset]) => [name, asset.stats])) }, null, 2));
