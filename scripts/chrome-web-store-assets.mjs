/**
 * Chrome ウェブストアの掲載用画像を作る（extensions/chrome/store/）
 *
 *   screenshot-<n>-<lang>.png   1280x800（ストアのスクリーンショットの規定サイズ）
 *   promo-small-<lang>.png      440x280（小さいプロモーション タイル）
 *
 * マニュアル用に撮った図（manual/public/screenshots/web-clip-*.png）に見出しを付けて並べるだけ。
 * 図を撮り直したら、このスクリプトも回し直す。
 *
 * 使い方: node scripts/chrome-web-store-assets.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, "../manual/public/screenshots");
const OUT = resolve(__dirname, "../extensions/chrome/store");
mkdirSync(OUT, { recursive: true });

const img = (path) => `data:image/png;base64,${readFileSync(path).toString("base64")}`;
const shot = (name) => img(resolve(SHOTS, `${name}.png`));
const logo = img(resolve(__dirname, "../public/logo.png"));

const TEXT = {
  en: {
    s1: ["Keep the sentences that matter", "Select text and click the toolbar icon. It becomes a memo and a quote in that page's note."],
    s2: ["Connect by allowing it in Graphium", "Press Connect, check that the numbers match, and press Allow. No codes to copy."],
    s3: ["Nothing leaves your computer", "Clips go only to Graphium on 127.0.0.1. No analytics, no remote servers."],
    s3Points: ["Sends only to the Graphium app on this computer", "Reads a page only when you clip it", "Unsent clips wait until Graphium is running"],
    tile: ["Web Clip", "Clip what you read into Graphium"],
  },
  ja: {
    s1: ["大事な文だけを残す", "文を選んでツールバーのアイコンを押すと、メモになり、そのページのノートに引用として入ります。"],
    s2: ["Graphium で許可してつなぐ", "「Graphium とつなぐ」を押して、番号が同じか見比べて「許可する」。コードのコピーは要りません。"],
    s3: ["コンピューターの外には出ません", "送り先は 127.0.0.1 の Graphium だけ。アクセス解析も外部のサーバーもありません。"],
    s3Points: ["送るのはこのコンピューターの Graphium だけ", "ページを読むのはクリップしたときだけ", "送れなかったクリップは Graphium が起動するまで待つ"],
    tile: ["Web クリップ", "読んだところを Graphium へ"],
  },
};

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Segoe UI", sans-serif; color: #1b2e22; }
  .frame { width: 1280px; height: 800px; background: linear-gradient(160deg, #eef5ef 0%, #f8faf8 60%); padding: 56px 64px; display: flex; flex-direction: column; }
  h1 { font-size: 44px; font-weight: 700; letter-spacing: -0.01em; }
  p.sub { font-size: 22px; color: #4a5f51; margin-top: 12px; line-height: 1.5; max-width: 1100px; }
  .stage { flex: 1; display: flex; align-items: center; justify-content: center; gap: 40px; margin-top: 32px; min-height: 0; }
  .card { background: #fff; border-radius: 14px; box-shadow: 0 10px 40px rgba(27, 46, 34, 0.14); overflow: hidden; }
  .card img { display: block; }
  .brand { position: absolute; right: 64px; top: 56px; display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 600; color: #3f7a4c; }
  .brand img { width: 36px; height: 36px; }
  ul.points { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 22px; }
  ul.points li { font-size: 26px; display: flex; gap: 16px; align-items: center; }
  ul.points li::before { content: "✓"; flex: none; width: 40px; height: 40px; border-radius: 50%; background: #3f7a4c; color: #fff; font-size: 22px; display: flex; align-items: center; justify-content: center; }
`;

function slide(lang, [title, sub], stage) {
  return `<html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body>
    <div class="frame" style="position:relative">
      <div class="brand"><img src="${logo}">Graphium</div>
      <h1>${title}</h1><p class="sub">${sub}</p>
      <div class="stage">${stage}</div>
    </div></body></html>`;
}

function slides(lang) {
  const t = TEXT[lang];
  return [
    slide(lang, t.s1, `<div class="card"><img src="${shot("web-clip-note")}" style="width:1000px"></div>`),
    slide(
      lang,
      t.s2,
      `<div class="card"><img src="${shot("web-clip-extension")}" style="width:520px"></div>
       <div class="card"><img src="${shot("web-clip-pair")}" style="width:440px"></div>`,
    ),
    slide(
      lang,
      t.s3,
      `<ul class="points">${t.s3Points.map((s) => `<li>${s}</li>`).join("")}</ul>`,
    ),
  ];
}

function tile(lang) {
  const [name, tag] = TEXT[lang].tile;
  return `<html><head><meta charset="utf-8"><style>${BASE_CSS}
    .tile { width: 440px; height: 280px; background: linear-gradient(160deg, #e3efe5, #f8faf8); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; }
    .tile img { width: 88px; height: 88px; }
    .tile .name { font-size: 30px; font-weight: 700; }
    .tile .name span { color: #3f7a4c; }
    .tile .tag { font-size: 17px; color: #4a5f51; }
  </style></head><body><div class="tile"><img src="${logo}"><div class="name"><span>Graphium</span> ${name}</div><div class="tag">${tag}</div></div></body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const lang of Object.keys(TEXT)) {
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const [i, html] of slides(lang).entries()) {
    await page.setContent(html, { waitUntil: "load" });
    const file = resolve(OUT, `screenshot-${i + 1}-${lang}.png`);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 1280, height: 800 } });
    console.log(file);
  }
  await page.setViewportSize({ width: 440, height: 280 });
  await page.setContent(tile(lang), { waitUntil: "load" });
  const file = resolve(OUT, `promo-small-${lang}.png`);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 440, height: 280 } });
  console.log(file);
}
await browser.close();
