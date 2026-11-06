// @vitest-environment jsdom
// SelectionPill（素材のビューアで文を選んだときの小さな操作）のテスト。
//
// 対象の不変条件:
// - ノートの横に開いたピーク（SelectionQuoteProvider あり）でだけ「ノートに引用」が出る。
//   素材一覧など Provider が無い画面では「メモに保存」だけ
// - 「ノートに引用」は選んだ文の出典（素材・ページ）をそのまま渡し、ピルを閉じる（onDismiss）
// - 「メモに保存」は従来どおり onSaveAsMemo に渡る
// 文言は LocaleProvider の既定（jsdom → en）で照合する。

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { SelectionPill, type CitationSource } from "./SelectionPill";
import { SelectionQuoteProvider } from "./selection-quote-context";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

const SOURCE: CitationSource = {
  entry: { fileId: "pdf-1", name: "proofing.pdf", type: "pdf", url: "" },
  selectionText: "Let the dough rest for an hour.",
  pageNumber: 3,
};

describe("SelectionPill", () => {
  it("ノートが無い画面では「メモに保存」だけ", () => {
    render(
      <LocaleProvider>
        <SelectionPill source={SOURCE} onSaveAsMemo={() => {}} />
      </LocaleProvider>,
    );
    expect(screen.getByRole("button", { name: /Save as memo/ })).toBeTruthy();
    expect(screen.queryByTestId("selection-pill-quote-to-note")).toBeNull();
  });

  it("ノートの横のピークでは「ノートに引用」が出て、出典ごと渡してピルを閉じる", () => {
    const onQuoteToNote = vi.fn();
    const onDismiss = vi.fn();
    const onSaveAsMemo = vi.fn();
    render(
      <LocaleProvider>
        <SelectionQuoteProvider value={{ onQuoteToNote }}>
          <SelectionPill source={SOURCE} onSaveAsMemo={onSaveAsMemo} onDismiss={onDismiss} />
        </SelectionQuoteProvider>
      </LocaleProvider>,
    );
    const button = screen.getByTestId("selection-pill-quote-to-note");
    expect(button.textContent).toContain("Quote in note");
    fireEvent.click(button);
    expect(onQuoteToNote).toHaveBeenCalledWith(SOURCE);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // メモだけの保存とは別の操作（二重に作らない）
    expect(onSaveAsMemo).not.toHaveBeenCalled();
  });

  it("Provider の値が null（書けないノート）なら「ノートに引用」は出さない", () => {
    render(
      <LocaleProvider>
        <SelectionQuoteProvider value={null}>
          <SelectionPill source={SOURCE} onSaveAsMemo={() => {}} />
        </SelectionQuoteProvider>
      </LocaleProvider>,
    );
    expect(screen.queryByTestId("selection-pill-quote-to-note")).toBeNull();
  });

  it("「メモに保存」は onSaveAsMemo に渡る", () => {
    const onSaveAsMemo = vi.fn();
    render(
      <LocaleProvider>
        <SelectionQuoteProvider value={{ onQuoteToNote: () => {} }}>
          <SelectionPill source={SOURCE} onSaveAsMemo={onSaveAsMemo} />
        </SelectionQuoteProvider>
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Save as memo/ }));
    expect(onSaveAsMemo).toHaveBeenCalledWith(SOURCE);
  });
});
