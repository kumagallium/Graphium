// @vitest-environment jsdom
// フォルダ付与ピッカーのテスト。
//
// 対象の不変条件:
// - ピッカーでできるのは「いま操作している対象への付け外し」だけ。フォルダそのものを消すゴミ箱は無い
// - このピッカーで作ったばかりのフォルダだけ、鉛筆で名前を直せる（対象だけの差し替え onReplace で 1 回に渡す）
// - 作ったばかりのフォルダはチェックを外すと行ごと消える（どこにも残らない）。前からあるフォルダは行を残す
// - 直す入力欄の Esc は直すのをやめるだけで、ピッカーは閉じない
//
// 文言は LocaleProvider の既定（jsdom の navigator.language → en）で照合する。

import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { ContextTagPicker } from "./ContextTagPicker";
import {
  addNoteContext,
  aggregateNoteContexts,
  removeNoteContext,
  replaceNoteContext,
} from "./context-tags";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

// ほかのノートに付いているフォルダ。候補は親と同じく「ほか + この対象」から集計し直す
const OTHERS = [{ noteContexts: ["Sourdough"] }, { noteContexts: ["Rye"] }];

function Harness({
  initial = [],
  withReplace = true,
  onClose = () => {},
  onReplaceSpy,
}: {
  initial?: string[];
  withReplace?: boolean;
  onClose?: () => void;
  onReplaceSpy?: (from: string, to: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>(initial);
  return (
    <LocaleProvider>
      <ContextTagPicker
        position={{ top: 0, left: 0 }}
        onClose={onClose}
        selected={selected}
        suggestions={aggregateNoteContexts([...OTHERS, { noteContexts: selected }])}
        onAdd={(v) => setSelected((s) => addNoteContext(s, v) ?? [])}
        onRemove={(v) => setSelected((s) => removeNoteContext(s, v) ?? [])}
        onReplace={
          withReplace
            ? (from, to) => {
                onReplaceSpy?.(from, to);
                setSelected((s) => replaceNoteContext(s, from, to) ?? []);
              }
            : undefined
        }
      />
      <output data-testid="selected">{selected.join(",")}</output>
    </LocaleProvider>
  );
}

const searchBox = () => screen.getByPlaceholderText("Search folders, or type to create…");
const row = (name: string) => screen.queryByRole("menuitemcheckbox", { name: new RegExp(`^${name}`) });
const pencil = (name: string) =>
  screen.queryByRole("button", { name: `Fix the name of the folder "${name}"` });

function create(name: string) {
  fireEvent.change(searchBox(), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: `Create folder "${name}"` }));
}

describe("ContextTagPicker", () => {
  it("フォルダそのものを消すゴミ箱は出さない", () => {
    render(<Harness initial={["Sourdough"]} />);
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
  });

  it("作ったばかりのフォルダにだけ鉛筆が出る", () => {
    render(<Harness initial={["Sourdough"]} />);
    create("Sordough");
    expect(pencil("Sordough")).toBeTruthy();
    expect(pencil("Sourdough")).toBeNull();
    expect(pencil("Rye")).toBeNull();
  });

  it("鉛筆で直すと、対象だけの差し替えが 1 回で渡り、行も新しい名前になる", () => {
    const onReplaceSpy = vi.fn();
    render(<Harness onReplaceSpy={onReplaceSpy} />);
    create("Starer");

    fireEvent.click(pencil("Starer")!);
    const input = screen.getByRole("textbox", { name: 'Fix the name of the folder "Starer"' });
    fireEvent.change(input, { target: { value: "Starter" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onReplaceSpy).toHaveBeenCalledWith("Starer", "Starter");
    expect(screen.getByTestId("selected").textContent).toBe("Starter");
    expect(row("Starer")).toBeNull();
    expect(row("Starter")).toBeTruthy();
    // 直したあとも作ったばかりの扱いのまま（続けて直せる）
    expect(pencil("Starter")).toBeTruthy();
  });

  it("既にあるフォルダの名前に直すと、そちらに合流する", () => {
    render(<Harness />);
    create("Sordough");
    fireEvent.click(pencil("Sordough")!);
    const input = screen.getByRole("textbox", { name: 'Fix the name of the folder "Sordough"' });
    fireEvent.change(input, { target: { value: "sourdough" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByTestId("selected").textContent).toBe("sourdough");
    expect(row("Sordough")).toBeNull();
    // 前からあるフォルダなので鉛筆は出さない
    expect(pencil("Sourdough")).toBeNull();
    expect(pencil("sourdough")).toBeNull();
  });

  it("作ったばかりのフォルダはチェックを外すと行ごと消える", () => {
    render(<Harness />);
    create("Sordough");
    fireEvent.click(row("Sordough")!);

    expect(screen.getByTestId("selected").textContent).toBe("");
    expect(row("Sordough")).toBeNull();
    // 同じ名前でもう一度作り直せる
    create("Sordough");
    expect(row("Sordough")).toBeTruthy();
  });

  it("前からあるフォルダはチェックを外しても行を残す", () => {
    render(<Harness initial={["Sourdough"]} />);
    fireEvent.click(row("Sourdough")!);
    expect(screen.getByTestId("selected").textContent).toBe("");
    expect(row("Sourdough")).toBeTruthy();
  });

  it("直す入力欄の Esc は直すのをやめるだけで、ピッカーは閉じない", () => {
    const onClose = vi.fn();
    const onReplaceSpy = vi.fn();
    render(<Harness onClose={onClose} onReplaceSpy={onReplaceSpy} />);
    create("Sordough");
    fireEvent.click(pencil("Sordough")!);
    const input = screen.getByRole("textbox", { name: 'Fix the name of the folder "Sordough"' });
    fireEvent.change(input, { target: { value: "Sourdough" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(onReplaceSpy).not.toHaveBeenCalled();
    expect(row("Sordough")).toBeTruthy();
  });

  it("差し替えの手段が渡らなければ鉛筆は出さない", () => {
    render(<Harness withReplace={false} />);
    create("Sordough");
    expect(pencil("Sordough")).toBeNull();
  });
});
