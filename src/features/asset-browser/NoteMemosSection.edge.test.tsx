// @vitest-environment jsdom
// NoteMemosSection の「つながり（線）のメモ」の表示テスト。
//
// 対象の不変条件:
// - 辺のメモ（sourceEdge あり・sourceNote はこのノート）は、ノートの「Memos」タブに出る
// - ¶ の代わりに「{渡す側} → {受け取る側}」のチップを出す（作成時の名前のスナップショット）。
//   名前が無い端点は「名前のない手順 / 工程」
// - ブロックのメモの ¶ チップとは混ざらない。辺のメモを押してもブロックのハイライトは呼ばない
// 文言は LocaleProvider の既定（jsdom → en）で照合する。

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import type { CaptureIndex } from "../mobile-capture";
import { NoteMemosSection } from "./NoteMemosSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

const captureIndex: CaptureIndex = {
  version: 1,
  updatedAt: "2026-10-30T10:00:00.000Z",
  captures: [
    {
      id: "e1",
      text: "12 時間置く",
      createdAt: "2026-10-30T09:00:00.000Z",
      sourceNote: { fileId: "n1" },
      sourceEdge: { graph: "steps", from: "s1", to: "s2", fromLabel: "混合", toLabel: "焼成" },
    },
    {
      id: "e2",
      text: "冷却してから",
      createdAt: "2026-10-30T08:00:00.000Z",
      sourceNote: { fileId: "n1" },
      sourceEdge: { graph: "plan", from: "op-a", to: "op-b", fromLabel: "焼成" },
    },
    {
      id: "b1",
      text: "ブロックのメモ",
      createdAt: "2026-10-30T07:00:00.000Z",
      sourceNote: { fileId: "n1", blockId: "blk", blockText: "焼成温度" },
    },
    {
      id: "other",
      text: "別のノートの線",
      createdAt: "2026-10-30T06:00:00.000Z",
      sourceNote: { fileId: "n2" },
      sourceEdge: { graph: "steps", from: "x", to: "y", fromLabel: "他", toLabel: "他" },
    },
  ],
};

function setup(onHighlightBlock = vi.fn()) {
  render(
    <LocaleProvider>
      <NoteMemosSection noteFileId="n1" captureIndex={captureIndex} onHighlightBlock={onHighlightBlock} />
    </LocaleProvider>,
  );
  return { onHighlightBlock };
}

describe("NoteMemosSection — つながりのメモ", () => {
  it("このノートの辺のメモを、「渡す側 → 受け取る側」のチップつきで出す。別ノートの辺のメモは出さない", () => {
    setup();
    const chips = Array.from(document.querySelectorAll('[data-test="noteMemoEdgeChip"]')).map((c) => c.textContent);
    expect(chips).toEqual(["混合 → 焼成", "焼成 → Untitled operation"]);
    expect(screen.queryByText("別のノートの線")).toBeNull();
  });

  it("ブロックのメモは ¶ チップのまま（辺のチップは付かない）", () => {
    setup();
    expect(screen.getByText("焼成温度")).toBeTruthy();
    expect(document.querySelectorAll('[data-test="noteMemoEdgeChip"]')).toHaveLength(2);
  });

  it("辺のメモを押しても、ブロックのハイライトは呼ばない（ブロックのメモは呼ぶ）", () => {
    const { onHighlightBlock } = setup();
    fireEvent.click(screen.getByText("12 時間置く"));
    expect(onHighlightBlock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("ブロックのメモ"));
    expect(onHighlightBlock).toHaveBeenCalledWith("blk");
  });
});
