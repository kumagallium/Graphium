// @vitest-environment jsdom
// 一括操作バーの並べ方の決まり（表は 3 つまで・繰り上げ・1 項目のメニューは作らない・
// 実行中は表へ・対象が一部なら件数を添える・削除はアイコン）を固定する
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LocaleProvider } from "../i18n";
import { BulkActionBar, type BulkAction } from "./bulk-action-bar";

afterEach(cleanup);

const act = (id: string, extra: Partial<BulkAction> = {}): BulkAction => ({
  id,
  label: id,
  onClick: () => {},
  ...extra,
});

function renderBar(props: Partial<Parameters<typeof BulkActionBar>[0]>) {
  localStorage.setItem("graphium_locale", "en");
  return render(
    <LocaleProvider>
      <BulkActionBar count={5} onClear={() => {}} primary={[]} {...props} />
    </LocaleProvider>,
  );
}

describe("BulkActionBar", () => {
  it("件数は左に 1 回だけ出し、ボタンには付けない", () => {
    renderBar({ primary: [act("Share")] });
    expect(screen.getByText("5 selected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
  });

  it("表は 3 つまで。残りが 2 つ以上なら「その他」のメニューに入る", () => {
    renderBar({ primary: [act("a"), act("b"), act("c")], more: [act("d"), act("e")] });
    expect(screen.queryByRole("button", { name: "d" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    expect(screen.getByRole("menuitem", { name: "d" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "e" })).toBeTruthy();
  });

  it("primary が 3 つに満たなければ more から繰り上げる", () => {
    renderBar({ primary: [act("a")], more: [act("b"), act("c"), act("d"), act("e")] });
    expect(screen.getByRole("button", { name: "b" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "c" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "d" })).toBeNull();
  });

  it("メニューに 1 項目しか残らないならメニューを作らず表に出す", () => {
    renderBar({ primary: [act("a"), act("b"), act("c")], more: [act("d")] });
    expect(screen.getByRole("button", { name: "d" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /More/ })).toBeNull();
  });

  it("実行中の操作はメニューから表へ出て、押せない", () => {
    renderBar({
      primary: [act("a"), act("b"), act("c")],
      more: [act("d", { busyLabel: "Reading 1 / 3…" }), act("e"), act("f")],
    });
    const busy = screen.getByRole("button", { name: "Reading 1 / 3…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
  });

  it("対象が選択の一部だけなら件数を添え、全件なら添えない", () => {
    renderBar({ primary: [act("Download", { subsetCount: 2 }), act("Extract", { subsetCount: 5 })] });
    expect(screen.getByRole("button", { name: "Download (2)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Extract" })).toBeTruthy();
  });

  it("削除はアイコンのボタンで、件数つきの名前を持つ", () => {
    const onDelete = vi.fn();
    renderBar({ primary: [act("a")], onDelete, deleteLabel: "Delete 5" });
    fireEvent.click(screen.getByRole("button", { name: "Delete 5" }));
    expect(onDelete).toHaveBeenCalledOnce();
  });
});
