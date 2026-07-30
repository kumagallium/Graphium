#!/usr/bin/env node
// マニュアル（manual/）が実態から静かにズレるのを止めるためのチェック。
//
// リリース履歴は CHANGELOG.md をビルド時に取り込むので放っておいても最新になるが、
// ロードマップと各ページの「Added in vX.Y.Z」バッジは人が書くので、書き忘れると
// 誰にも気づかれないまま古くなる。それを CI で落とすのがこのスクリプト。
//
// 実行: pnpm manual:check

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MANUAL = path.join(ROOT, "manual");
const CHANGELOG = path.join(ROOT, "CHANGELOG.md");

/** ロードマップがこれ以上マイナー版を取りこぼしたら落とす */
const MAX_MINOR_LAG = 2;

const errors = [];
const warnings = [];

// ── 対象ファイルの収集（.vitepress と public は除く） ──────────────────
function markdownFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".vitepress" || entry.name === "public") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

const pages = markdownFiles(MANUAL);
const rel = (f) => path.relative(ROOT, f);

// ── CHANGELOG からリリース済みバージョンを読む ────────────────────────
const changelog = fs.readFileSync(CHANGELOG, "utf8");
const released = [...changelog.matchAll(/^## \[?(v\d+\.\d+\.\d+)\]?.*?- (\d{4}-\d{2}-\d{2})/gm)].map(
  (m) => ({ version: m[1], date: m[2] })
);
if (released.length === 0) {
  errors.push("CHANGELOG.md からリリースを 1 件も読めませんでした（見出しの形式が変わった？）");
}
const releasedVersions = new Map(released.map((r) => [r.version, r.date]));
const latestRelease = released[0];

const parse = (v) => v.replace(/^v/, "").split(".").map(Number);
/** a が b より新しければ正。sort にそのまま渡すと昇順になる。 */
const compareVersions = (a, b) => {
  const [aMaj, aMin, aPatch] = parse(a);
  const [bMaj, bMin, bPatch] = parse(b);
  return aMaj - bMaj || aMin - bMin || aPatch - bPatch;
};
/** a から b までのマイナー版の距離（b が新しいほど正） */
const minorDistance = (a, b) => {
  const [aMaj, aMin] = parse(a);
  const [bMaj, bMin] = parse(b);
  return (bMaj - aMaj) * 1000 + (bMin - aMin);
};

// ── 1. バッジのバージョンが実在するか ─────────────────────────────────
// 英語版: text="Added in v0.18.0 (2026-07-15)" / 日本語版: text="v0.18.0 (2026-07-15) で追加"
const BADGE = /<Badge[^>]*text="[^"]*?(v\d+\.\d+\.\d+)\s*\((\d{4}-\d{2}-\d{2})\)[^"]*"/g;
const badgeVersions = new Set();

for (const file of pages) {
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(BADGE)) {
    const [, version, date] = m;
    badgeVersions.add(version);
    const releasedDate = releasedVersions.get(version);
    if (!releasedDate) {
      errors.push(`${rel(file)}: バッジの ${version} が CHANGELOG に存在しません`);
    } else if (releasedDate !== date) {
      errors.push(
        `${rel(file)}: バッジ ${version} の日付が ${date} ですが、CHANGELOG では ${releasedDate} です`
      );
    }
  }
}

// ── 2. ロードマップが遅れていないか / 日英で揃っているか ───────────────
const roadmaps = {
  en: path.join(MANUAL, "roadmap.md"),
  ja: path.join(MANUAL, "ja", "roadmap.md"),
};
const roadmapVersions = {};

for (const [locale, file] of Object.entries(roadmaps)) {
  if (!fs.existsSync(file)) {
    errors.push(`${rel(file)} がありません`);
    continue;
  }
  const text = fs.readFileSync(file, "utf8");
  // 表の 1 列目に太字で置いたバージョン: | **v0.23.0** | ... |
  const versions = new Set([...text.matchAll(/\|\s*\*\*(v\d+\.\d+\.\d+)\*\*\s*\|/g)].map((m) => m[1]));
  roadmapVersions[locale] = versions;

  if (versions.size === 0) {
    errors.push(`${rel(file)}: 節目を 1 件も読めませんでした（表の形式が変わった？）`);
    continue;
  }
  for (const v of versions) {
    if (!releasedVersions.has(v)) {
      errors.push(`${rel(file)}: ロードマップの ${v} が CHANGELOG に存在しません`);
    }
  }
  const newest = [...versions].sort(compareVersions).at(-1);
  const lag = minorDistance(newest, latestRelease.version);
  if (lag > MAX_MINOR_LAG) {
    errors.push(
      `${rel(file)}: 最新の節目が ${newest} ですが、リリースは ${latestRelease.version} まで進んでいます` +
        `（${lag} マイナー分の遅れ）。この間に載せるべき節目が無いか確認し、` +
        `無ければ最新版の行を足すか MAX_MINOR_LAG を見直してください`
    );
  }
}

if (roadmapVersions.en && roadmapVersions.ja) {
  const onlyEn = [...roadmapVersions.en].filter((v) => !roadmapVersions.ja.has(v));
  const onlyJa = [...roadmapVersions.ja].filter((v) => !roadmapVersions.en.has(v));
  if (onlyEn.length) errors.push(`ロードマップ: 英語版にしかない節目 ${onlyEn.join(", ")}`);
  if (onlyJa.length) errors.push(`ロードマップ: 日本語版にしかない節目 ${onlyJa.join(", ")}`);
}

// ── 3. 画像・内部リンク・アンカーの実在 ───────────────────────────────
const shots = new Set(fs.readdirSync(path.join(MANUAL, "public", "screenshots")));

/** 見出しから VitePress の anchor id を作る（明示 {#id} が最優先） */
function headingAnchors(text) {
  const ids = new Set();
  for (const m of text.matchAll(/^#{2,4}\s+(.+?)\s*$/gm)) {
    const heading = m[1];
    const explicit = heading.match(/\{#([^}]+)\}/);
    if (explicit) {
      ids.add(explicit[1]);
      continue;
    }
    ids.add(
      heading
        .replace(/<Badge[^>]*\/>/g, "")
        .replace(/`/g, "")
        .toLowerCase()
        .trim()
        .replace(/[^\w぀-ヿ一-鿿\s-]/g, "")
        .replace(/\s+/g, "-")
    );
  }
  return ids;
}

const anchorCache = new Map();
function anchorsOf(file) {
  if (!anchorCache.has(file)) anchorCache.set(file, headingAnchors(fs.readFileSync(file, "utf8")));
  return anchorCache.get(file);
}

for (const file of pages) {
  const text = fs.readFileSync(file, "utf8");

  for (const m of text.matchAll(/!\[[^\]]*\]\(\/screenshots\/([^)]+)\)/g)) {
    if (!shots.has(m[1])) errors.push(`${rel(file)}: 画像 ${m[1]} がありません`);
  }

  for (const m of text.matchAll(/(?<!!)\[[^\]]+\]\((\/(?:ja\/)?[a-z][a-z0-9-]*)(#[^)]+)?\)/g)) {
    const [, page, anchor] = m;
    const target = page === "/ja" ? path.join(MANUAL, "ja", "index.md") : path.join(MANUAL, page + ".md");
    if (!fs.existsSync(target)) {
      errors.push(`${rel(file)}: リンク先 ${page} がありません`);
      continue;
    }
    if (anchor && !anchorsOf(target).has(anchor.slice(1))) {
      errors.push(`${rel(file)}: ${page}${anchor} のアンカーが見つかりません`);
    }
  }
}

// ── 4. 未使用のスクリーンショット（警告のみ） ─────────────────────────
const used = new Set();
for (const file of pages) {
  for (const m of fs.readFileSync(file, "utf8").matchAll(/\/screenshots\/([^)\s]+)/g)) used.add(m[1]);
}
for (const shot of shots) {
  if (!used.has(shot)) warnings.push(`どのページからも参照されていない画像: ${shot}`);
}

// ── 結果 ──────────────────────────────────────────────────────────────
const pageCount = pages.length;
console.log(
  `manual:check — ページ ${pageCount} 件 / 図 ${shots.size} 件 / バッジのバージョン ${badgeVersions.size} 種 / 最新リリース ${latestRelease?.version ?? "?"}`
);
for (const w of warnings) console.log(`  warn: ${w}`);
if (errors.length) {
  console.error(`\n${errors.length} 件の問題:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("問題なし");
