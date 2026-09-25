// スラッシュメニュー項目の一覧（blocks/slash-items）の回帰ガード
//
// SidePeek はメインエディタの並行実装で、項目の一覧を別々に書いていた頃は
// メインにだけ足された項目がピークに出なかった（チャートをピークで作れなかった）。
// 一覧を blocks/slash-items の 1 か所にまとめ、両方がそこから取ることで防いでいる。
// このテストは「一覧の中身」と「両方がその一覧を使っていること」を確かめる。

import { describe, it, expect, vi, afterEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const platform = vi.hoisted(() => ({ tauri: false }));
vi.mock("../lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/platform")>()),
  isTauri: () => platform.tauri,
}));

import { getCommonSlashMenuItems, getMainEditorOnlySlashMenuItems } from "./slash-items";
import { chartSlashItem } from "./chart";
import { sharedCitationSlashItem } from "./shared-citation";
import { indexTableSlashItem } from "../features/index-table";
import { logTableSlashItem } from "../features/log-table";
import { getCiteSlashMenuItems } from "../features/cite-picker/slash-menu-items";
import { getTemplateSlashMenuItem } from "../features/template/slash-menu-item";

const titles = (items: { title: string }[]) => items.map((item) => item.title);

afterEach(() => {
  platform.tauri = false;
});

describe("getCommonSlashMenuItems", () => {
  it("チャートはどのエディタでも出る（SidePeek でも作れる）", () => {
    expect(getCommonSlashMenuItems({ includeCite: false })).toContain(chartSlashItem);
    expect(getCommonSlashMenuItems({ includeCite: true })).toContain(chartSlashItem);
  });

  it("ノート・wiki の引用は includeCite のときだけ出る", () => {
    const citeTitles = titles(getCiteSlashMenuItems());
    expect(citeTitles.length).toBeGreaterThan(0);
    const withCite = titles(getCommonSlashMenuItems({ includeCite: true }));
    const withoutCite = titles(getCommonSlashMenuItems({ includeCite: false }));
    for (const title of citeTitles) {
      expect(withCite).toContain(title);
      expect(withoutCite).not.toContain(title);
    }
  });

  it("共有ライブラリの引用はデスクトップ版だけで出る", () => {
    expect(getCommonSlashMenuItems({ includeCite: true })).not.toContain(sharedCitationSlashItem);
    platform.tauri = true;
    expect(getCommonSlashMenuItems({ includeCite: true })).toContain(sharedCitationSlashItem);
  });
});

describe("getMainEditorOnlySlashMenuItems", () => {
  it("メインに固定の受け口で動く項目だけを持つ", () => {
    expect(titles(getMainEditorOnlySlashMenuItems())).toEqual([
      indexTableSlashItem.title,
      logTableSlashItem.title,
      getTemplateSlashMenuItem().title,
    ]);
  });

  it("共通の一覧には混ざらない（ピークで押すとメイン側に書き込むため）", () => {
    platform.tauri = true;
    const common = titles(getCommonSlashMenuItems({ includeCite: true }));
    for (const title of titles(getMainEditorOnlySlashMenuItems())) {
      expect(common).not.toContain(title);
    }
  });
});

// ── 構造ガード: エディタに渡す一覧は blocks/slash-items から取る ──

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));
const PROP = "extraSlashMenuItems={";
/** note-app の状態を閉じ込めた項目。blocks/slash-items に置けないので直接並べてよい */
const ALLOWED_DIRECT_ITEMS = new Set(["newNoteSlashItem"]);
const LIST_FUNCTIONS = new Set(["getCommonSlashMenuItems", "getMainEditorOnlySlashMenuItems"]);

/** src 配下の .ts/.tsx を列挙する（テストとストーリーは除く） */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      collectSourceFiles(path, out);
      continue;
    }
    if (!/\.tsx?$/.test(name)) continue;
    if (/\.(test|spec|stories)\.tsx?$/.test(name)) continue;
    out.push(path);
  }
  return out;
}

/** `extraSlashMenuItems={...}` の式の中身を、括弧の対応を見て取り出す */
function readPropExpressions(source: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf(PROP, from);
    if (at < 0) return out;
    const start = at + PROP.length;
    let depth = 1;
    let i = start;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") depth--;
    }
    out.push(source.slice(start, i - 1));
    from = i;
  }
}

function findSlashItemSites(): { file: string; expr: string }[] {
  const sites: { file: string; expr: string }[] = [];
  for (const file of collectSourceFiles(SRC_DIR)) {
    const source = readFileSync(file, "utf8");
    for (const expr of readPropExpressions(source)) {
      sites.push({ file: file.slice(SRC_DIR.length), expr });
    }
  }
  return sites;
}

describe("構造ガード", () => {
  const sites = findSlashItemSites();

  it("メインエディタと SidePeek の両方を見つけている", () => {
    // prop 名が変わってガードが空振りするのを防ぐ
    const files = sites.map((site) => site.file);
    expect(files).toContain("note-app.tsx");
    expect(files).toContain("features/index-table/side-peek.tsx");
  });

  it("どのエディタも共通の一覧を使う", () => {
    const missing = sites
      .filter((site) => !/\bcommonSlashItems\b|\bgetCommonSlashMenuItems\(/.test(site.expr))
      .map((site) => site.file);
    expect(missing, `blocks/slash-items の共通の一覧を使ってください: ${missing.join(", ")}`).toEqual([]);
  });

  it("個別の項目をエディタに直接並べていない", () => {
    // 直接並べると、その画面にだけ出る項目が生まれる（チャートの漏れと同じ形）
    const offenders: string[] = [];
    for (const site of sites) {
      for (const [name] of site.expr.matchAll(/\b\w+SlashItem\b/g)) {
        if (!ALLOWED_DIRECT_ITEMS.has(name)) offenders.push(`${site.file}: ${name}`);
      }
      for (const [name] of site.expr.matchAll(/\bget\w+SlashMenuItems?\b/g)) {
        if (!LIST_FUNCTIONS.has(name)) offenders.push(`${site.file}: ${name}()`);
      }
    }
    expect(
      offenders,
      "項目は blocks/slash-items の一覧に足してください" +
        "（どのエディタでも動くなら common、メインに固定の受け口なら main-only）: " +
        offenders.join(", "),
    ).toEqual([]);
  });
});
