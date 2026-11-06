// @vitest-environment jsdom
// アプリ内の確認ダイアログ（window.confirm の代わり）。文言は既定の en で照合する。
// - ホストが無ければ false（黙って進めない）
// - OK で true、キャンセル・Esc・背景クリックで false
// - 開いたら焦点は「キャンセル」（Enter の押し間違いで破壊的な操作に進まない）
// - 2 つ目の確認が来たら、1 つ目は false で閉じる

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { LocaleProvider } from "../i18n";
import { ConfirmHost, confirmAction, __setConfirmResponderForTest } from "./confirm-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
  __setConfirmResponderForTest(null);
});

function mountHost() {
  render(
    <LocaleProvider>
      <ConfirmHost />
    </LocaleProvider>,
  );
}

describe("confirmAction", () => {
  it("ホストが無ければ false", async () => {
    expect(await confirmAction("Delete?")).toBe(false);
  });

  it("OK で true", async () => {
    mountHost();
    let p!: Promise<boolean>;
    act(() => {
      p = confirmAction("Delete this saved point?", { destructive: true });
    });
    expect(screen.getByText("Delete this saved point?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(await p).toBe(true);
    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
  });

  it("キャンセルで false。焦点は最初からキャンセルにある", async () => {
    mountHost();
    let p!: Promise<boolean>;
    act(() => {
      p = confirmAction("Move to trash?");
    });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.click(cancel);
    expect(await p).toBe(false);
  });

  it("Esc と背景クリックでも false", async () => {
    mountHost();
    let p1!: Promise<boolean>;
    act(() => {
      p1 = confirmAction("A?");
    });
    fireEvent.keyDown(screen.getByTestId("confirm-dialog"), { key: "Escape" });
    expect(await p1).toBe(false);
    let p2!: Promise<boolean>;
    act(() => {
      p2 = confirmAction("B?");
    });
    fireEvent.mouseDown(screen.getByTestId("confirm-dialog"));
    expect(await p2).toBe(false);
  });

  it("確認ボタンの文言を差し替えられる", async () => {
    mountHost();
    let p!: Promise<boolean>;
    act(() => {
      p = confirmAction("Restore?", { confirmLabel: "Restore" });
    });
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(await p).toBe(true);
  });

  it("2 つ目が来たら 1 つ目は false で閉じる", async () => {
    mountHost();
    let p1!: Promise<boolean>;
    let p2!: Promise<boolean>;
    act(() => {
      p1 = confirmAction("First?");
    });
    act(() => {
      p2 = confirmAction("Second?");
    });
    expect(await p1).toBe(false);
    expect(screen.getByText("Second?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(await p2).toBe(true);
  });

  it("テスト用の答えを差し込める", async () => {
    __setConfirmResponderForTest((m) => m === "yes?");
    expect(await confirmAction("yes?")).toBe(true);
    expect(await confirmAction("no?")).toBe(false);
  });
});
