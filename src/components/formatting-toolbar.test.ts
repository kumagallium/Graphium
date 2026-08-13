// 浮上ツールバーの表示可否判定のユニットテスト
//
// content: "none" のブロック（数式・計算・チャート等）を選ぶと、書式もインライン
// ラベルも適用対象が無いため標準アイテムは全部消え、AI ボタン 1 個だけが残る。
// その AI ボタンも選択テキストが空で押しても無反応なので、「押せないボタンが
// ブロックに被さるだけ」になる。これを出さないための判定を守るテスト。
//
// 以前はチャート専用のハードコード判定だったため、後から入った数式ブロックを
// 取りこぼした。スキーマの content を見る形に一般化したので、新しいカスタム
// ブロックが増えても自動的に対象になる — その性質をここで固定する。

import { describe, it, expect, vi } from "vitest";

// formatting-toolbar は media-ocr 経由で tesseract.js を、step/view 経由で
// BlockNote の描画系を引き込む。検証したいのは選択判定だけなので、重い依存は
// モックして読み込みを軽くする。
vi.mock("../features/media-ocr", () => ({
  useMediaOcrStoreOptional: () => null,
  ImageOcrToolbarButton: () => null,
}));

import { getNodeSelectionBlockType, isToolbarlessBlockSelection } from "./formatting-toolbar";

// 実際のエディタスキーマと同じ content 種別（src/blocks/registry.ts の登録に対応）
const BLOCK_SCHEMA: Record<string, { content: string }> = {
  paragraph: { content: "inline" },
  heading: { content: "inline" },
  callout: { content: "inline" },
  step: { content: "inline" },
  table: { content: "table" },
  // メディア（ツールバーにラベル・OCR の導線があるので出す）
  image: { content: "none" },
  video: { content: "none" },
  audio: { content: "none" },
  file: { content: "none" },
  pdf: { content: "none" },
  // 本文テキストを持たないブロック（ツールバーを出さない）
  math: { content: "none" },
  chart: { content: "none" },
  divider: { content: "none" },
  bookmark: { content: "none" },
  sharedCitation: { content: "none" },
  columnList: { content: "none" },
  column: { content: "none" },
  // feat/calc-block でマージ予定の計算ブロック。マージ時に判定へ自動で乗ることを固定する
  calc: { content: "none" },
};

type MockOpts = {
  /** NodeSelection の対象。null なら TextSelection（通常の文字選択）扱い */
  selection: { nodeTypeName: string; blockId?: string; ancestors?: string[] } | null;
  /** blockId → ブロック型 */
  blocks?: Record<string, string>;
};

/** 判定に必要な最小限の editor スタブ（tiptap の selection と BlockNote のスキーマ） */
function makeEditor({ selection, blocks = {} }: MockOpts) {
  const ancestorNodes = (selection?.ancestors ?? []).map((name) => ({
    type: { name },
    attrs: { id: name === "blockContainer" ? selection?.blockId : undefined },
  }));

  return {
    _tiptapEditor: {
      state: {
        selection: selection
          ? {
              node: {
                type: { name: selection.nodeTypeName },
                attrs: { id: selection.blockId },
              },
              $from: {
                depth: ancestorNodes.length - 1,
                node: (depth: number) => ancestorNodes[depth],
              },
            }
          : { node: undefined },
      },
    },
    schema: { blockSchema: BLOCK_SCHEMA },
    getBlock: (id: string) => (blocks[id] ? { id, type: blocks[id] } : undefined),
  };
}

/** blockContainer ごと選ばれる実測パターン（数式・チャートはこちら） */
function selectBlock(blockType: string) {
  return makeEditor({
    selection: { nodeTypeName: "blockContainer", blockId: "b1" },
    blocks: { b1: blockType },
  });
}

describe("getNodeSelectionBlockType", () => {
  it("blockContainer の NodeSelection からブロック型を引く", () => {
    expect(getNodeSelectionBlockType(selectBlock("math"))).toBe("math");
  });

  it("ブロック本体が選ばれた場合は祖先の blockContainer から引く", () => {
    const editor = makeEditor({
      selection: {
        nodeTypeName: "math",
        blockId: "b1",
        ancestors: ["doc", "blockGroup", "blockContainer"],
      },
      blocks: { b1: "math" },
    });
    expect(getNodeSelectionBlockType(editor)).toBe("math");
  });

  it("TextSelection（通常の文字選択）では null", () => {
    expect(getNodeSelectionBlockType(makeEditor({ selection: null }))).toBeNull();
  });

  it("editor が未初期化でも落ちない", () => {
    expect(getNodeSelectionBlockType(undefined)).toBeNull();
    expect(getNodeSelectionBlockType({})).toBeNull();
  });
});

describe("isToolbarlessBlockSelection", () => {
  // 本文テキストを持たない ＝ ツールバーに出せる操作が無い
  it.each(["math", "calc", "chart", "divider", "bookmark", "sharedCitation"])(
    "%s の選択ではツールバーを出さない",
    (blockType) => {
      expect(isToolbarlessBlockSelection(selectBlock(blockType))).toBe(true);
    },
  );

  // メディアは content: "none" でもインラインラベル・OCR の導線を載せている
  it.each(["image", "video", "audio", "file", "pdf"])(
    "%s の選択ではツールバーを出す（ラベル・OCR の導線があるため）",
    (blockType) => {
      expect(isToolbarlessBlockSelection(selectBlock(blockType))).toBe(false);
    },
  );

  it("本文を持つブロック（段落・見出し）ではツールバーを出す", () => {
    expect(isToolbarlessBlockSelection(selectBlock("paragraph"))).toBe(false);
    expect(isToolbarlessBlockSelection(selectBlock("heading"))).toBe(false);
  });

  it("テキスト選択中はツールバーを出す", () => {
    expect(isToolbarlessBlockSelection(makeEditor({ selection: null }))).toBe(false);
  });

  it("スキーマに無いブロック型では判定を保留してツールバーを出す", () => {
    const editor = makeEditor({
      selection: { nodeTypeName: "blockContainer", blockId: "b1" },
      blocks: { b1: "unknownBlock" },
    });
    expect(isToolbarlessBlockSelection(editor)).toBe(false);
  });
});
