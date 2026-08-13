// @vitest-environment jsdom
//
// 言語切替が画面に反映されるかのテスト。
//
// BlockNote のカスタムブロックは LocaleProvider の Context を辿れない場所で
// 描画され得るため、モジュールスコープの t() を使っている。値を読めるだけでは
// 言語を切り替えても再レンダーが起きず、古いラベルが残ったままになる。
// useLocaleSubscription() がその再レンダーを担う。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { LocaleProvider, syncLocale, t, useLocale, useLocaleSubscription } from "./index";

beforeEach(() => {
  syncLocale("en");
});

afterEach(() => {
  cleanup();
  syncLocale("en");
});

/** カスタムブロックの render 相当（Context を使わず、モジュールの t() を呼ぶ） */
function BlockLikeLabel() {
  useLocaleSubscription();
  return <span data-testid="label">{t("common.save")}</span>;
}

describe("useLocaleSubscription()", () => {
  it("LocaleProvider の外でも言語切替で再レンダーされる", () => {
    render(<BlockLikeLabel />);
    expect(screen.getByTestId("label").textContent).toBe("Save");

    act(() => syncLocale("ja"));
    expect(screen.getByTestId("label").textContent).toBe("保存");

    act(() => syncLocale("en"));
    expect(screen.getByTestId("label").textContent).toBe("Save");
  });

  it("購読していないと古いラベルが残る（この購読が必要な理由）", () => {
    function Unsubscribed() {
      return <span data-testid="stale">{t("common.save")}</span>;
    }
    render(<Unsubscribed />);
    expect(screen.getByTestId("stale").textContent).toBe("Save");

    act(() => syncLocale("ja"));
    // 再レンダーが起きないので英語のまま。これが修正前のブロックの症状。
    expect(screen.getByTestId("stale").textContent).toBe("Save");
  });

  it("アンマウント後の syncLocale で購読が残らない", () => {
    const { unmount } = render(<BlockLikeLabel />);
    unmount();
    // 購読解除できていなければ、消えたコンポーネントへの更新で警告・例外になる
    expect(() => act(() => syncLocale("ja"))).not.toThrow();
  });
});

describe("LocaleProvider", () => {
  it("setLocale が Context 内と Context 外の両方を更新する", () => {
    function Switcher() {
      const { locale, setLocale } = useLocale();
      return (
        <div>
          <span data-testid="ctx">{locale}</span>
          <button onClick={() => setLocale("ja")}>switch</button>
        </div>
      );
    }

    render(
      <LocaleProvider>
        <Switcher />
      </LocaleProvider>,
    );
    // Context 外のブロックは Provider の子として描画されるとは限らないので別に置く
    render(<BlockLikeLabel />);

    expect(screen.getByTestId("ctx").textContent).toBe("en");
    expect(screen.getByTestId("label").textContent).toBe("Save");

    act(() => screen.getByText("switch").click());

    expect(screen.getByTestId("ctx").textContent).toBe("ja");
    expect(screen.getByTestId("label").textContent).toBe("保存");
    expect(localStorage.getItem("graphium_locale")).toBe("ja");
  });
});
