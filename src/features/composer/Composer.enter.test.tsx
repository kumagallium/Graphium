// @vitest-environment jsdom
// ⌘K の素の Enter を AI に倒さない回帰ガード
//
// 一致が無いとき、素の Enter が AI への質問になっていた（探したかったのに AI に聞いてしまう）。
// 確かめるのは次の 4 点:
// - 一致が無く「記録で探す」があれば、Enter はそちらを開き、AI には送らない
// - 一致も「記録で探す」も無ければ、Enter は何もしない
// - ⌘+Enter はこれまでどおり AI に送る
// - ↓ で AI の行を選んでからの Enter は AI に送る

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { LocaleProvider } from "@/i18n";
import { Composer } from "./Composer";
import type { GraphiumIndex } from "../navigation/index-file";

const index: GraphiumIndex = {
  version: 6,
  updatedAt: "2026-04-25T10:00:00.000Z",
  notes: [
    {
      noteId: "a",
      title: "Dough hydration log",
      modifiedAt: "2026-04-25T10:00:00.000Z",
      createdAt: "2026-04-25T10:00:00.000Z",
      headings: [],
      labels: [],
      outgoingLinks: [],
      source: "human",
    },
  ],
};

function setup(props: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const onSubmit = vi.fn();
  const onSeeInRecords = vi.fn();
  const onNoteSelect = vi.fn();
  const utils = render(
    <LocaleProvider>
      <Composer
        open
        mode="ask"
        onModeChange={() => {}}
        prompt="zzz-no-such-word"
        onPromptChange={() => {}}
        onSubmit={onSubmit}
        onClose={() => {}}
        noteIndex={index}
        onNoteSelect={onNoteSelect}
        onSeeInRecords={onSeeInRecords}
        canAskAi
        {...props}
      />
    </LocaleProvider>,
  );
  const input = () => utils.container.ownerDocument.querySelector("input") as HTMLInputElement;
  return { ...utils, onSubmit, onSeeInRecords, onNoteSelect, input };
}

afterEach(cleanup);

// jsdom には scrollIntoView が無い（↓ でアクティブ行を見える範囲に入れる処理が呼ぶ）
Element.prototype.scrollIntoView ??= () => {};

describe("Composer: 一致が無いときの Enter は AI に送らない", () => {
  it("「記録で探す」があれば Enter はそちらを開く", () => {
    const { input, onSubmit, onSeeInRecords } = setup();
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onSeeInRecords).toHaveBeenCalledWith("zzz-no-such-word");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("「記録で探す」も無ければ Enter は何もしない", () => {
    const { input, onSubmit } = setup({ onSeeInRecords: undefined });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("⌘+Enter は AI に送る", () => {
    const { input, onSubmit, onSeeInRecords } = setup();
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSeeInRecords).not.toHaveBeenCalled();
  });

  it("↓ で AI の行を選んでからの Enter は AI に送る", () => {
    const { input, onSubmit, onSeeInRecords } = setup();
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSeeInRecords).not.toHaveBeenCalled();
  });

  it("一致があれば Enter はこれまでどおり先頭の行を開く", () => {
    const { input, onSubmit, onNoteSelect } = setup({ prompt: "Dough" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onNoteSelect).toHaveBeenCalledWith("a", "human");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
