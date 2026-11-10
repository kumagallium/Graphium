// 隔離された見本モードを開き、公開用の実画面を撮影する。
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
// 並走環境では明示した Vite ポートを使用する。
const portIndex = process.argv.indexOf('--port');
const port = portIndex < 0 ? 5196 : Number(process.argv[portIndex + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3001) {
  throw new Error('隔離された Vite のポートを --port で指定してください');
}
const origin = `http://localhost:${port}`;
const base = `${origin}/Graphium/app/?demo=bread-en`;
const onlyIndex = process.argv.indexOf('--only');
const only = onlyIndex < 0 ? '' : process.argv[onlyIndex + 1];
if (only && only !== 'hero') throw new Error('--only は hero を指定してください');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
await context.addInitScript(() => {
  localStorage.setItem('graphium_locale', 'en');
  localStorage.setItem('graphium-zoom-hint-dismissed', '1');
  localStorage.setItem('graphium:graphSelectionLearned', '1');
});
const page = await context.newPage();
// アプリ経由の隔離 API 以外への通信を遮断する。
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin === origin || ['blob:', 'data:'].includes(url.protocol)) await route.continue();
  else await route.abort();
});
try {
  await page.goto(base);
  await page.waitForTimeout(7000);
  const welcome = page.getByRole('button', { name: 'Open Graphium', exact: true });
  if (await welcome.isVisible()) await welcome.click();
  await page.getByRole('button', { name: 'Close the walkthrough', exact: true }).click();
  if (!only) {
    // Steps パネルは既定で開く場合があるため、閉じているときだけ押す（トグルで閉じてしまうのを防ぐ）。
    if (!(await page.getByText(/\d+ nodes/).first().isVisible())) await page.getByRole('button', { name: 'Steps', exact: true }).click();
    await page.mouse.move(1100, 50);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: resolve('public/landing/screen-editor.png') });
    console.log('screen-editor.png: @引用つきノートを撮影');
    await page.getByText('Knowledge', { exact: true }).first().click();
    await page.getByRole('button', { name: /^Topics/ }).click();
    await page.waitForTimeout(1600);
    await page.screenshot({ path: resolve('public/landing/screen-knowledge.png') });
    console.log('screen-knowledge.png: Topics一覧を撮影');
  }
  await page.getByRole('button', { name: 'Global Graph', exact: true }).click();
  await page.getByRole('button', { name: 'Type', exact: true }).click();
  await page.waitForTimeout(7000);
  // 検索は関連ノードも1ホップ残すため、元ノートと知見・洞察の関係を保てる。
  await page.getByPlaceholder('Search...', { exact: true }).fill('flour protein');
  await page.waitForTimeout(1200);
  await page.waitForTimeout(1000);
  // 実際に表示された位置を読み、マウス操作だけでノードを離して並べる。
  const bundle = JSON.parse(readFileSync(resolve('public/demo/bread-en.json'), 'utf8'));
  const kinds = new Map(bundle.wiki.map(entry => [entry.id, entry.doc.wikiMeta.kind]));
  const visible = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(e => e._cyreg?.cy);
    return el._cyreg.cy.nodes().filter(n => n.visible()).map(n => ({ id: n.id(), label: n.data('fullLabel') }));
  });
  const counters = { note: 0, claim: 0, atom: 0, topic: 0 };
  for (const node of visible) {
    const kind = kinds.get(node.id) ?? 'note';
    const index = counters[kind]++;
    const target = kind === 'note' ? { x: 450, y: 200 + index * 150 }
      : kind === 'claim' ? { x: 780, y: 240 + index * 180 }
      : kind === 'atom' ? { x: 1130, y: 310 + index * 170 }
      : { x: 1130, y: 650 + index * 130 };
    const source = await page.evaluate(id => {
      const el = [...document.querySelectorAll('div')].find(e => e._cyreg?.cy);
      const p = el._cyreg.cy.getElementById(id).renderedPosition();
      const box = el.getBoundingClientRect();
      return { x: box.x + p.x, y: box.y + p.y };
    }, node.id);
    await page.mouse.move(source.x, source.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 20 });
    await page.mouse.up();
  }
  await page.mouse.move(800, 450);
  await page.mouse.wheel(0, -65);
  await page.waitForTimeout(700);
  console.log('表示ノード', visible.length, counters);
  await page.mouse.move(280, 30);
  await page.screenshot({ path: resolve('public/landing/hero.png') });
  console.log('hero.png: flour proteinで絞った型別カラーの全体グラフを撮影');
  if (!only) {
    await page.evaluate(() => { location.hash = '#knowledge/atom/e2b78259-9f6d-4562-9674-fca04c0eeddf'; });
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Graph', exact: true }).click();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Lineage', exact: true }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: resolve('public/landing/screen-trace.png') });
    console.log('screen-trace.png: 洞察とLineageパネルを撮影');
  }
} finally {
  await browser.close();
}
