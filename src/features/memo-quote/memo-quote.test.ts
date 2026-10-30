// @vitest-environment jsdom
// メモの引用の純関数のテスト（紐づけの状態・生きている紐づけ・縦線の CSS）。
//
// 対象の不変条件:
// - 元のメモが引用時のまま = synced / 本文が変わった = updated / ゴミ箱・完全削除 = deleted
// - 本文にブロックが無い紐づけは無視する（掃除し損ねても表に出ない）
// - 縦線の CSS は紐づいた quote ブロックだけに当たり、ハイライト用の style とは別物

import { describe, it, expect } from "vitest";
import {
  MEMO_QUOTE_COLOR,
  buildMemoQuoteRef,
  findQuoteMemo,
  liveMemoQuoteEntries,
  memoQuoteStatus,
  memoQuoteStyleCss,
  collectQuoteBlockIds,
  memoQuoteChipInset,
  pruneMemoQuotes,
} from "./memo-quote";
import type { CaptureEntry, CaptureIndex } from "../mobile-capture/capture-store";

const memo = (over: Partial<CaptureEntry> = {}): CaptureEntry => ({
  id: "cap_1",
  text: "粒界に析出物が見える",
  createdAt: "2026-10-30T10:00:00.000Z",
  ...over,
});
const index = (...captures: CaptureEntry[]): CaptureIndex => ({
  version: 1,
  updatedAt: "2026-10-30T00:00:00.000Z",
  captures,
});

describe("buildMemoQuoteRef", () => {
  it("メモの id・本文と、引用した日時を持つ", () => {
    expect(buildMemoQuoteRef(memo(), "2026-10-30T11:00:00.000Z")).toEqual({
      captureId: "cap_1",
      quotedAt: "2026-10-30T11:00:00.000Z",
      quotedText: "粒界に析出物が見える",
    });
  });

  it("日時を省くと現在時刻（ISO）になる", () => {
    const ref = buildMemoQuoteRef(memo());
    expect(new Date(ref.quotedAt).toISOString()).toBe(ref.quotedAt);
  });
});

describe("memoQuoteStatus", () => {
  const ref = buildMemoQuoteRef(memo());

  it("本文が引用時のままなら synced", () => {
    expect(memoQuoteStatus(ref, memo())).toBe("synced");
  });

  it("引用後にメモの本文が変わっていれば updated", () => {
    expect(memoQuoteStatus(ref, memo({ text: "粒界に析出物が見える（追記）" }))).toBe("updated");
  });

  it("アーカイブしたメモは参照が残るので deleted にしない", () => {
    expect(memoQuoteStatus(ref, memo({ archivedAt: "2026-10-31T00:00:00.000Z" }))).toBe("synced");
  });

  it("ゴミ箱（deletedAt）・完全削除（undefined）は deleted", () => {
    expect(memoQuoteStatus(ref, memo({ deletedAt: "2026-10-31T00:00:00.000Z" }))).toBe("deleted");
    expect(memoQuoteStatus(ref, undefined)).toBe("deleted");
    expect(memoQuoteStatus(ref, null)).toBe("deleted");
  });
});

describe("findQuoteMemo", () => {
  it("id で引く。ゴミ箱のメモも返す（状態の判定は memoQuoteStatus）。無ければ undefined", () => {
    const trashed = memo({ id: "cap_2", deletedAt: "2026-10-31T00:00:00.000Z" });
    const idx = index(memo(), trashed);
    expect(findQuoteMemo(idx, "cap_1")?.id).toBe("cap_1");
    expect(findQuoteMemo(idx, "cap_2")).toBe(trashed);
    expect(findQuoteMemo(idx, "nope")).toBeUndefined();
    expect(findQuoteMemo(null, "cap_1")).toBeUndefined();
  });
});

describe("liveMemoQuoteEntries", () => {
  const ref = (id: string) => buildMemoQuoteRef(memo({ id }));

  it("本文にブロックがある紐づけだけを返す（Record でも Map でも）", () => {
    const record = { b1: ref("a"), b2: ref("b") };
    expect(liveMemoQuoteEntries(record, new Set(["b2"])).map(([id]) => id)).toEqual(["b2"]);
    const map = new Map(Object.entries(record));
    expect(liveMemoQuoteEntries(map, new Set(["b1", "b2"])).map(([id]) => id)).toEqual(["b1", "b2"]);
  });

  it("未設定・空は空配列", () => {
    expect(liveMemoQuoteEntries(undefined, new Set(["b1"]))).toEqual([]);
    expect(liveMemoQuoteEntries(null, new Set(["b1"]))).toEqual([]);
    expect(liveMemoQuoteEntries({}, new Set(["b1"]))).toEqual([]);
  });
});

describe("memoQuoteStyleCss", () => {
  it("紐づいた quote ブロックの左の縦線をメモの色にし、印の分だけ右を空ける", () => {
    const css = memoQuoteStyleCss(["b1"]);
    expect(css).toContain('[data-id="b1"][data-node-type="blockOuter"]');
    expect(css).toContain('[data-content-type="quote"] blockquote');
    expect(css).toContain(`border-left-color: ${MEMO_QUOTE_COLOR}`);
    expect(css).toContain("padding-right:");
  });

  it("そのブロック自身の中身だけに当てる（子結合子）。子ブロックの通常の quote には当たらない", () => {
    const css = memoQuoteStyleCss(["b1"]);
    expect(css).toContain('[data-node-type="blockOuter"] > [data-node-type="blockContainer"] > [data-content-type="quote"]');
    // 実物の BlockNote の DOM（blockOuter > blockContainer > .bn-block-content、子は blockGroup 内）で当たり方を確かめる
    document.body.innerHTML = `
      <div data-node-type="blockOuter" data-id="b1"><div data-node-type="blockContainer" data-id="b1">
        <div class="bn-block-content" data-content-type="quote"><blockquote id="self"></blockquote></div>
        <div data-node-type="blockGroup"><div data-node-type="blockOuter" data-id="child"><div data-node-type="blockContainer" data-id="child">
          <div class="bn-block-content" data-content-type="quote"><blockquote id="child-bq"></blockquote></div>
        </div></div></div>
      </div></div>`;
    const rule = css.slice(0, css.indexOf(" {"));
    expect(Array.from(document.querySelectorAll(rule)).map((e) => e.id)).toEqual(["self"]);
    document.body.innerHTML = "";
  });

  it("ブロックごとに 1 規則。空なら空文字", () => {
    expect(memoQuoteStyleCss(["a", "b"]).split("\n")).toHaveLength(2);
    expect(memoQuoteStyleCss([])).toBe("");
  });

  it("id の引用符・バックスラッシュはエスケープして、規則を壊さない", () => {
    const css = memoQuoteStyleCss(['x"] { color: red } [data-id="y']);
    // 引用符の前に \ が入る（属性値の中に閉じ込められる）
    expect(css).toContain('x\\"] { color: red }');
    expect(css).not.toMatch(/[^\\]"\] \{ color: red/);
    expect(css.split("\n")).toHaveLength(1);
  });
});

describe("collectQuoteBlockIds / pruneMemoQuotes", () => {
  const blocks = [
    { id: "q1", type: "quote" },
    { id: "p1", type: "paragraph", children: [{ id: "q-nested", type: "quote" }, { id: "h1", type: "heading" }] },
  ];
  const ref = (id: string) => ({ captureId: id, quotedAt: "2026-10-30T00:00:00Z", quotedText: "メモ" });

  it("子ブロックを含め、種別が quote のものだけ", () => {
    expect([...collectQuoteBlockIds(blocks)].sort()).toEqual(["q-nested", "q1"]);
    expect(collectQuoteBlockIds(undefined).size).toBe(0);
  });

  it("保存用: 本文に実在する quote ブロックの項目だけ残す（消した・種別を変えたものは落とす）。残りが無ければ undefined", () => {
    const snapshot = { q1: ref("a"), "q-nested": ref("b"), gone: ref("c"), p1: ref("d") };
    expect(pruneMemoQuotes(snapshot, blocks)).toEqual({ q1: ref("a"), "q-nested": ref("b") });
    expect(pruneMemoQuotes({ gone: ref("c") }, blocks)).toBeUndefined();
    expect(pruneMemoQuotes({}, blocks)).toBeUndefined();
    // 元の snapshot は変えない（ストアの項目は Undo のために残る）
    expect(Object.keys(snapshot)).toHaveLength(4);
  });
});

describe("memoQuoteChipInset", () => {
  it("高さが十分なら既定の余白。1 行など低いブロックは縦中央に寄せ、負にはならない", () => {
    expect(memoQuoteChipInset(40, 8)).toBe(8);
    expect(memoQuoteChipInset(38, 8)).toBe(8);
    expect(memoQuoteChipInset(27, 8)).toBe(2.5);
    expect(memoQuoteChipInset(22, 8)).toBe(0);
    expect(memoQuoteChipInset(10, 8)).toBe(0);
  });
});
