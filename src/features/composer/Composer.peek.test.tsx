// @vitest-environment jsdom
// ⌘K のノート行から「サイドピークで開く」の回帰ガード
//
// リンクの無いノートを今のノートの横に置く入口。確かめるのは次の 4 点:
// - ハンドラがあるときだけ行の右端にボタンが出て、押すとピークのハンドラだけが呼ばれる
// - ⌥+Enter でも同じく開け、通常の Enter はこれまでどおりジャンプになる
// - 開けない行（今開いているノート自身）にはボタンが出ず、⌥+Enter でジャンプにも倒れない
// - ハンドラが無いとき（エディタが出ていない画面）はボタンも出ない

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
  const peekButtons = () => utils.queryAllByLabelText(t("composer.note.openInPeek"));
  const input = () => utils.container.ownerDocument.querySelector("input") as HTMLInputElement;
  return { ...utils, onNoteSelect, onNoteOpenInPeek, peekButtons, input };
}

afterEach(cleanup);

describe("Composer: ノート行をサイドピークで開く", () => {
  it("行の右端のボタンでピークのハンドラだけが呼ばれる", () => {
    const { peekButtons, onNoteOpenInPeek, onNoteSelect } = setup();
    expect(peekButtons()).toHaveLength(2);
    fireEvent.click(peekButtons()[1]);
    expect(onNoteOpenInPeek).toHaveBeenCalledWith("b", "human");
    expect(onNoteSelect).not.toHaveBeenCalled();
  });

  it("⌥+Enter で選択中の行をピークで開き、通常の Enter はジャンプのまま", () => {
    const { input, onNoteOpenInPeek, onNoteSelect } = setup();
    fireEvent.keyDown(input(), { key: "Enter", altKey: true });
    expect(onNoteOpenInPeek).toHaveBeenCalledWith("a", "human");
    expect(onNoteSelect).not.toHaveBeenCalled();

    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onNoteSelect).toHaveBeenCalledWith("a", "human");
    expect(onNoteOpenInPeek).toHaveBeenCalledTimes(1);
  });

  it("開けない行にはボタンを出さず、⌥+Enter でもジャンプに倒れない", () => {
    const { peekButtons, input, onNoteOpenInPeek, onNoteSelect } = setup({
      canOpenNoteInPeek: (id) => id !== "a",
    });
    expect(peekButtons()).toHaveLength(1);
    fireEvent.keyDown(input(), { key: "Enter", altKey: true });
    expect(onNoteOpenInPeek).not.toHaveBeenCalled();
    expect(onNoteSelect).not.toHaveBeenCalled();
  });

  it("ハンドラが無いときはボタンを出さない", () => {
    const { peekButtons } = setup({ onNoteOpenInPeek: undefined });
    expect(peekButtons()).toHaveLength(0);
  });
});
