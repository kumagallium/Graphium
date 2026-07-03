// ──────────────────────────────────────────────
// label-auto の自動ラベル設定ロジックの単体テスト
//
// setupLabelAutoAssign が返す onDocChange を直接呼び、
// エディタの onChange 経路（メインエディタ・サイドピーク双方）が
// 依存する挙動を固定する:
//   1. 箇条書き Enter → 継承対象ラベルを次行へ継承
//   2. free ラベルは継承しない
//   3. インデント → material/tool/output を attribute に変換
//   4. ブロック削除 → 孤立ラベルをクリーンアップ
//   5. 先頭 Enter（分割）→ ラベルを新ブロックへ転送
// ──────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { setupLabelAutoAssign } from "./label-auto";
import type { LabelStore } from "./store";

/** setLabel を即時にマップへ反映する同期フェイクストア（React state を介さず検証する） */
function makeLabelStore(): LabelStore {
  const labels = new Map<string, string>();
  const attributes = new Map<string, any>();
  const store: Partial<LabelStore> = {
    labels,
    attributes,
    setLabel: (blockId, label) => {
      if (label === null) labels.delete(blockId);
      else labels.set(blockId, label);
    },
    getLabel: (blockId) => labels.get(blockId),
    setAttributes: (blockId, attrs) => {
      attributes.set(blockId, { ...(attributes.get(blockId) ?? {}), ...attrs });
    },
    getAttributes: (blockId) => attributes.get(blockId),
    getSnapshot: () => ({
      labels: Array.from(labels.entries()),
      attributes: Array.from(attributes.entries()),
    }),
    restoreSnapshot: () => {},
  };
  return store as LabelStore;
}

/** テキスト有無で content を切り替える箇条書きブロック */
function bullet(id: string, text: string) {
  return {
    id,
    type: "bulletListItem",
    content: text ? [{ type: "text", text }] : [],
    children: [] as any[],
  };
}

/** editor.document を差し替え可能な最小フェイクエディタ */
function makeEditor(doc: any[]) {
  return { document: doc };
}

describe("setupLabelAutoAssign", () => {
  it("継承対象ラベル(material)が付いた箇条書きで Enter すると次の空行に継承される", () => {
    const store = makeLabelStore();
    const a = bullet("a", "銅板");
    const editor = makeEditor([a]);
    const onChange = setupLabelAutoAssign(editor, store);

    // A に material を付与済みの状態から Enter → 空の B が追加された
    store.setLabel("a", "material");
    editor.document = [a, bullet("b", "")];
    onChange();

    expect(store.labels.get("b")).toBe("material");
  });

  it("free ラベル(目的)は継承しない", () => {
    const store = makeLabelStore();
    const a = bullet("a", "銅板");
    const editor = makeEditor([a]);
    const onChange = setupLabelAutoAssign(editor, store);

    store.setLabel("a", "goal"); // free ラベル（INHERITABLE_LABELS に含まれない）
    editor.document = [a, bullet("b", "")];
    onChange();

    expect(store.labels.has("b")).toBe(false);
  });

  it("material 箇条書きをインデントすると attribute に変わる", () => {
    const store = makeLabelStore();
    // depth 0 の A（親）と、後で depth を上げる B
    const parent = bullet("parent", "手順");
    const child = bullet("child", "銅板");
    parent.children = [];
    const editor = makeEditor([parent, child]);
    const onChange = setupLabelAutoAssign(editor, store);

    store.setLabel("child", "material");
    // child を parent の子（depth 1）に移動 = インデント
    parent.children = [child];
    editor.document = [parent];
    onChange();

    expect(store.labels.get("child")).toBe("attribute");
  });

  it("ブロックを削除すると孤立ラベルがクリーンアップされる", () => {
    const store = makeLabelStore();
    const a = bullet("a", "銅板");
    const b = bullet("b", "鉄板");
    const editor = makeEditor([a, b]);
    const onChange = setupLabelAutoAssign(editor, store);

    store.setLabel("a", "material");
    store.setLabel("b", "goal");
    // A を削除
    editor.document = [b];
    onChange();

    expect(store.labels.has("a")).toBe(false);
    expect(store.labels.get("b")).toBe("goal");
  });

  it("先頭 Enter でブロックが分割されるとラベルが新ブロックへ転送される", () => {
    const store = makeLabelStore();
    const a = bullet("a", "銅板");
    const editor = makeEditor([a]);
    const onChange = setupLabelAutoAssign(editor, store);

    store.setLabel("a", "material");
    // 先頭で Enter: A が空になり、コンテンツを持つ新ブロック B が直後に入る
    editor.document = [bullet("a", ""), bullet("b", "銅板")];
    onChange();

    expect(store.labels.has("a")).toBe(false);
    expect(store.labels.get("b")).toBe("material");
  });
});
