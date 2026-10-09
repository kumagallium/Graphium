// @vitest-environment jsdom
// DecisionRationalePrompt のテスト: 空文字は送れない・送信で onSubmit が呼ばれる。

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { DecisionRationalePrompt } from "./DecisionRationalePrompt";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

const items = [
  { wikiId: "w1", title: "判断 A", action: "A をする", targetNoteId: "n1", targetNoteTitle: "ノート" },
];

function setup(onSubmit = vi.fn(async () => {})) {
  render(
    <LocaleProvider>
      <DecisionRationalePrompt items={items} onSubmit={onSubmit} onClose={() => {}} />
    </LocaleProvider>,
  );
  return onSubmit;
}

describe("DecisionRationalePrompt", () => {
  it("空文字（空白のみ）では送信されない", () => {
    const onSubmit = setup();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form")!);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("送信で onSubmit が呼ばれ、記入済み表示になる", async () => {
    const onSubmit = setup();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: " 乾燥が要るから " } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("w1", "乾燥が要るから"));
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  });

  it("IME 変換確定の Enter（keyCode 229）は keydown の既定動作（暗黙送信）を止める", () => {
    setup();
    const input = screen.getByRole("textbox");
    // fireEvent は preventDefault されていなければ true を返す
    const notPrevented = fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(notPrevented).toBe(false);
    // 通常の Enter は止めない
    expect(fireEvent.keyDown(input, { key: "Enter", keyCode: 13 })).toBe(true);
  });
});
