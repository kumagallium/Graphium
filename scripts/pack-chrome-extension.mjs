/**
 * Chrome ウェブストアに上げる zip を作る（extensions/chrome → dist-extension/）
 *
 * manifest.json を zip の直下に置く。テスト・README・ストア用の素材（store/）は入れない。
 *
 * 使い方:
 *   pnpm ext:pack
 *   → dist-extension/graphium-web-clip-<manifest の version>.zip
 */
import { zipSync } from "fflate";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "../extensions/chrome");
const OUT = resolve(__dirname, "../dist-extension");

// 入れないもの: 開発用のファイルとストア掲載用の素材
const EXCLUDE = [/\.test\.[jt]s$/, /^README\.md$/, /^store\//, /(^|\/)\.DS_Store$/];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = {};
for (const p of walk(SRC)) {
  const rel = relative(SRC, p).split("\\").join("/");
  if (EXCLUDE.some((re) => re.test(rel))) continue;
  files[rel] = readFileSync(p);
}
if (!files["manifest.json"]) throw new Error("manifest.json が見つかりません");

const { version } = JSON.parse(files["manifest.json"].toString("utf8"));
mkdirSync(OUT, { recursive: true });
const out = join(OUT, `graphium-web-clip-${version}.zip`);
// 時刻を固定して、中身が同じなら同じ zip になるようにする
writeFileSync(out, zipSync(files, { level: 9, mtime: new Date("2026-01-01T00:00:00Z") }));
console.log(`${relative(process.cwd(), out)}（${Object.keys(files).length} ファイル）`);
for (const name of Object.keys(files).sort()) console.log(`  ${name}`);
