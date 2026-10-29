// @vitest-environment jsdom
// ⌘K のノート行をサイドピークで開く回帰ガード
//
// ノートを開いているとき（onNoteOpenInPeek あり）は、ノート行の既定が「今のノートの横に
// サイドピークで開く」になり、全画面へのジャンプは右端のボタンと ⇧+Enter に移る。
// 確かめるのは次の 4 点:
// - クリック・Enter はピークのハンドラだけを呼ぶ
// - 右端のボタン・⇧+Enter はジャンプのハンドラだけを呼ぶ
// - 開けない行（今開いているノート自身）は既定がジャンプのままで、ボタンも出ない
// - ハンドラが無いとき（エディタが出ていない画面）はこれまでどおり既定がジャンプ

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { LocaleProvider, t } from "@/i18n";
import { Composer } from "./Composer";
import type { GraphiumIndex, NoteIndexEntry } from "../navigation/index-file";

function note(noteId: string, title: string, modifiedAt: string): NoteIndexEntry {
  return {
    noteId,
    title,
    modifiedAt,
    createdAt: modifiedAt,
    headings: [],
    labels: [],
    outgoingLinks: [],
    source: "human",
  };
}

const index: GraphiumIndex = {
  version: 6,
  updatedAt: "2026-04-25T10:00:00.000Z",
  // 入力空のときは更新日の新しい順に並ぶ（先頭が a）
  notes: [
    note("a", "Dough hydration log", "2026-04-25T10:00:00.000Z"),
    note("b", "Starter feeding schedule", "2026-04-24T10:00:00.000Z"),
  ],
};

function setup(props: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const onNoteSelect = vi.fn();
  const onNoteOpenInPeek = vi.fn();
  const utils = render(
    <LocaleProvider>
      <Composer
        open
        mode="ask"
        onModeChange={() => {}}
        prompt=""
        onPromptChange={() => {}}
        onSubmit={() => {}}
        onClose={() => {}}
        noteIndex={index}
        onNoteSelect={onNoteSelect}
        onNoteOpenInPeek={onNoteOpenInPeek}
        canAskAi={false}
        {...props}
      />
    </LocaleProvider>,
  );
  const fullButtons = () => utils.queryAllByLabelText(t("composer.note.openFull"));
  const rowByTitle = (title: string) => utils.getByText(title).closest("button") as HTMLButtonElement;
  const input = () => utils.container.ownerDocument.querySelector("input") as HTMLInputElement;
  return { ...utils, onNoteSelect, onNoteOpenInPeek, fullButtons, rowByTitle, input };
}

afterEach(cleanup);

describe("Composer: ノートを開いているときはサイドピークが既定", () => {
  it("行のクリックと Enter はサイドピークで開く", () => {
    const { rowByTitle, input, onNoteOpenInPeek, onNoteSelect } = setup();
    fireEvent.click(rowByTitle("Starter feeding schedule"));
    expect(onNoteOpenInPeek).toHaveBeenCalledWith("b", "human");

    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onNoteOpenInPeek).toHaveBeenLastCalledWith("a", "human");
    expect(onNoteSelect).not.toHaveBeenCalled();
  });

  it("右端のボタンと ⇧+Enter は全画面へジャンプする", () => {
    const { fullButtons, input, onNoteOpenInPeek, onNoteSelect } = setup();
    expect(fullButtons()).toHaveLength(2);
    fireEvent.click(fullButtons()[1]);
    expect(onNoteSelect).toHaveBeenCalledWith("b", "human");

    fireEvent.keyDown(input(), { key: "Enter", shiftKey: true });
    expect(onNoteSelect).toHaveBeenLastCalledWith("a", "human");
    expect(onNoteOpenInPeek).not.toHaveBeenCalled();
  });

  it("開けない行は既定がジャンプのままで、全画面ボタンも出さない", () => {
    const { fullButtons, input, onNoteOpenInPeek, onNoteSelect } = setup({
      canOpenNoteInPeek: (id) => id !== "a",
    });
    expect(fullButtons()).toHaveLength(1);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onNoteSelect).toHaveBeenCalledWith("a", "human");
    expect(onNoteOpenInPeek).not.toHaveBeenCalled();
  });

  it("ハンドラが無いときは既定がジャンプで、ボタンも出さない", () => {
    const { fullButtons, rowByTitle, onNoteSelect } = setup({ onNoteOpenInPeek: undefined });
    expect(fullButtons()).toHaveLength(0);
    fireEvent.click(rowByTitle("Starter feeding schedule"));
    expect(onNoteSelect).toHaveBeenCalledWith("b", "human");
  });
});
