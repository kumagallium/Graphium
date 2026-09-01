// スラッシュメニュー項目とカスタムブロックの i18n 回帰ガード
//
// モジュールのトップレベルで `title: t("slash.math")` と書くと、その文字列は
// モジュールが最初に読み込まれた時点の言語で固定される。項目オブジェクトは
// 一度作ったら作り直されないため、あとから言語を切り替えてもメニューには
// 古い言語のラベルが残り続ける（ブロックのヘッダーラベルも同じ理由で残る）。
//
// 対策は 2 つあり、このテストは両方が守られているかを構造的に検証する:
//   1. スラッシュメニュー項目のラベルは getter にして、読むたびに引き直す
//   2. ブロックの render は useLocaleSubscription() でロケール変更を購読する

import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// pdf-viewer は react-pdf（canvas/DOMMatrix 前提）を読み込むため、node 環境では
// 描画まわりだけモックする。検証したいのはラベルの評価タイミングであって PDF 描画ではない。
vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock("../lib/pdfjs-config", () => ({}));

import { syncLocale } from "../i18n";
import { bookmarkSlashItem } from "./bookmark";
import { calloutSlashItem } from "./callout";
import { chartSlashItem } from "./chart";
import { mathSlashItem } from "./math";
import { columnsSlashItem } from "./multi-column";
import { pdfSlashItem } from "./pdf-viewer";
import { sharedCitationSlashItem } from "./shared-citation";
import { stepSlashItem } from "./step";
import { indexTableSlashItem } from "../features/index-table";
import { logTableSlashItem } from "../features/log-table";
import { inlineMathSlashItem } from "../features/inline-math/spec";
import { getMediaSlashMenuItems } from "../features/asset-browser/slash-menu-items";
import { getCiteSlashMenuItems } from "../features/cite-picker/slash-menu-items";
import { getMemoSlashMenuItem } from "../features/mobile-capture/slash-menu-item";
import { getTemplateSlashMenuItem } from "../features/template/slash-menu-item";

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));

/** src 配下の .ts/.tsx を列挙する（テストとストーリーは除く） */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "node_modules") continue;
      collectSourceFiles(path, out);
      continue;
    }
    if (!/\.tsx?$/.test(name)) continue;
    if (/\.(test|spec|stories)\.tsx?$/.test(name)) continue;
    out.push(path);
  }
  return out;
}

/** 即時評価されたスラッシュメニューのラベル行（1 始まり）を返す */
function scanLines(lines: string[]): number[] {
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*(title|subtext|group):\s*t(Static)?\(/.test(lines[i])) continue;
    // このラベルを囲んでいる宣言の名前を遡って探す
    let owner = "";
    for (let j = i - 1; j >= 0; j--) {
      const decl = lines[j].match(/^\s*(?:export\s+)?(?:const|function)\s+(\w+)/);
      if (decl) {
        owner = decl[1];
        break;
      }
    }
    if (/slash/i.test(owner)) hits.push(i + 1);
  }
  return hits;
}

/**
 * 「描画のたびに Context 非依存の t() を引く React コンポーネント」を持つファイルか。
 * ＝ useLocaleSubscription() が要る形。除いているのは次の 3 つ。
 *
 *  1. useLocale() / useT() から受け取る t。Provider の再描画に素直に追従するので
 *     購読は要らない。見るのは i18n から直接 import した名前だけ。
 *  2. スラッシュメニュー項目のラベル getter。読むたびに引き直すので購読は要らない
 *     （上の 2 つのテストが別途守っている）。
 *  3. JSX を書けない .ts。BlockNote へ DOM をそのまま返す描画がこれで、フックを
 *     置ける React コンポーネントがそもそも無い（blocks/remote-content の
 *     image / video / audio 差し替えと、そのプレースホルダ）。この形の文言が言語切替に
 *     追従する根拠は base/editor.tsx 側にあり、useCreateBlockNote の deps に locale が
 *     入っている＝切り替えるとエディタごと作り直されて枠も組み直される。
 *     実際に切り替えて文言が入れ替わることは blocks/remote-content/gate.test.ts が
 *     エディタをマウントして確かめている（deps から locale が外れるとあちらが赤くなる）。
 */
function needsLocaleSubscription(path: string, source: string): boolean {
  if (!path.endsWith(".tsx")) return false;
  const imported = Array.from(
    source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"[^"]*i18n"/g),
    (m) => m[1],
  )
    .join(",")
    .split(",")
    .map((s) => s.trim());
  const rendering = source.replace(/^\s*get (title|subtext|group)\(\).*$/gm, "");
  if (imported.includes("t") && /\bt\("/.test(rendering)) return true;
  return (
    imported.includes("getCalloutVariantLabel") && /getCalloutVariantLabel\(/.test(rendering)
  );
}

function findEagerSlashLabels(): string[] {
  const offenders: string[] = [];
  for (const file of collectSourceFiles(SRC_DIR)) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (const line of scanLines(lines)) {
      offenders.push(`${file.slice(SRC_DIR.length)}:${line}`);
    }
  }
  return offenders;
}

// ロケールを跨いで検証するので、項目は「名前つきで」まとめて回す
const slashItems: Record<string, unknown> = {
  bookmarkSlashItem,
  calloutSlashItem,
  chartSlashItem,
  mathSlashItem,
  columnsSlashItem,
  pdfSlashItem,
  sharedCitationSlashItem,
  stepSlashItem,
  indexTableSlashItem,
  logTableSlashItem,
  inlineMathSlashItem,
  ...Object.fromEntries(
    getMediaSlashMenuItems().map((item, i) => [`mediaSlashItem[${i}]`, item]),
  ),
  ...Object.fromEntries(
    getCiteSlashMenuItems().map((item, i) => [`citeSlashItem[${i}]`, item]),
  ),
  memoSlashItem: getMemoSlashMenuItem(),
  templateSlashItem: getTemplateSlashMenuItem(),
};

describe("スラッシュメニュー項目のラベルは遅延評価される", () => {
  it("title / subtext / group が getter として定義されている", () => {
    // 値として持っていると、その時点の言語で固定される
    const eager: string[] = [];
    for (const [name, item] of Object.entries(slashItems)) {
      for (const key of ["title", "subtext", "group"] as const) {
        const desc = Object.getOwnPropertyDescriptor(item as object, key);
        if (!desc) continue; // subtext は任意
        if (typeof desc.get !== "function") eager.push(`${name}.${key}`);
      }
    }
    expect(eager, `getter でないラベル: ${eager.join(", ")}`).toEqual([]);
  });

  it("言語を切り替えると全項目のラベルが切り替わる", () => {
    syncLocale("en");
    const beforeTitles = Object.fromEntries(
      Object.entries(slashItems).map(([name, item]) => [name, (item as any).title]),
    );
    const beforeGroups = new Set(
      Object.values(slashItems).map((item) => (item as any).group),
    );

    syncLocale("ja");

    // グループ名は英語のまま残っていないこと（見出しだけ旧言語で残る事故を防ぐ）
    for (const item of Object.values(slashItems)) {
      expect(beforeGroups.has((item as any).group)).toBe(false);
    }
    // 代表項目は辞書どおりの日本語になること
    expect((mathSlashItem as any).title).toBe("数式");
    expect((mathSlashItem as any).subtext).toBe("独立した行に数式を表示（LaTeX）");
    expect((mathSlashItem as any).group).toBe("高度なブロック");
    expect((calloutSlashItem as any).title).toBe("コールアウト");
    expect((logTableSlashItem as any).title).toBe("時系列テーブル");
    expect(beforeTitles.mathSlashItem).toBe("Formula");

    syncLocale("en");
    expect((mathSlashItem as any).title).toBe("Formula");
    expect((calloutSlashItem as any).title).toBe("Callout");
  });
});

describe("構造ガード", () => {
  it("スラッシュメニュー項目が t() を即時評価していない", () => {
    // ラベル行を見つけたら、それを囲む宣言（const / function）の名前を遡って調べる。
    // 名前に slash を含むものだけが対象。描画のたびに組み直される他の UI 文言
    // （discovery カード等）は即時評価でも問題ないので巻き込まない。
    const offenders = findEagerSlashLabels();
    expect(
      offenders,
      `ラベルを getter にしてください（言語切替で古い文字列が残ります）: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("この検出ロジック自体が即時評価を見逃さない", () => {
    // ガードが実際に効くことを確かめる（常に空を返すだけの検出では意味がない）
    const sample = [
      "export const fooSlashItem = {",
      '  title: t("slash.foo"),',
      '  get group() { return t("slash.advancedGroup"); },',
      "};",
      "function buildDiscoveryCards() {",
      '  return { title: t("composer.discovery.clarifyTitle") };',
      "}",
    ];
    expect(scanLines(sample)).toEqual([2]);
  });

  it("Context 非依存の t() で描画するカスタムブロックは useLocaleSubscription() を呼んでいる", () => {
    // BlockNote の render は LocaleProvider の Context を辿れないため、
    // 購読しないと言語を切り替えてもヘッダーラベルが再描画されない。
    // 何を「購読が要る形」と見なすかは needsLocaleSubscription の doc を参照。
    const blocksDir = join(SRC_DIR, "blocks");
    const missing: string[] = [];
    const covered: string[] = [];
    for (const name of readdirSync(blocksDir)) {
      const dir = join(blocksDir, name);
      if (!statSync(dir).isDirectory()) continue;
      const files = collectSourceFiles(dir);
      if (!files.some((f) => needsLocaleSubscription(f, readFileSync(f, "utf8")))) continue;
      covered.push(name);
      const sources = files.map((f) => readFileSync(f, "utf8"));
      if (!sources.some((s) => s.includes("useLocaleSubscription()"))) missing.push(name);
    }
    expect(
      missing,
      `useLocaleSubscription() の呼び出しが無いブロック: ${missing.join(", ")}`,
    ).toEqual([]);
    // 検出条件を絞りすぎて「対象 0 件で緑」になっていないこと。
    // 数が減るのは正しい変更でも起こり得るが、代表格が外れたら条件を疑う。
    expect(covered).toEqual(expect.arrayContaining(["bookmark", "callout", "chart", "math"]));
  });

  it("この検出条件が Context 経由の t と DOM 描画を巻き込まない", () => {
    // ガードが効く側（購読が要る形）
    expect(
      needsLocaleSubscription(
        "view.tsx",
        'import { t, useLocaleSubscription } from "../../i18n";\nconst C = () => <p>{t("block.x")}</p>;',
      ),
    ).toBe(true);
    // useLocale() から受け取る t は Provider の再描画で追従する
    expect(
      needsLocaleSubscription(
        "Bar.tsx",
        'import { useLocale } from "../../i18n";\nconst B = () => { const { t } = useLocale(); return <p>{t("note.x")}</p>; };',
      ),
    ).toBe(false);
    // .ts は JSX を書けない＝フックを置くコンポーネントが無い
    expect(
      needsLocaleSubscription(
        "placeholder.ts",
        'import { t } from "../../i18n";\nexport function make() { el.textContent = t("block.x"); }',
      ),
    ).toBe(false);
    // ラベル getter は読むたびに引き直すので購読は要らない
    expect(
      needsLocaleSubscription(
        "index.tsx",
        'import { t } from "../../i18n";\nexport const fooSlashItem = {\n  get title() { return t("slash.foo"); },\n};',
      ),
    ).toBe(false);
  });
});
