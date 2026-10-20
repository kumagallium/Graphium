// @vitest-environment jsdom
// 差し替えた shadcn Button が ref を実 DOM まで通すことの回帰テスト。
//
// ここが壊れると base-ui のトリガーの anchor が null になり、テーブルハンドルや
// ドラッグハンドルのメニューが「一度も配置されない」状態で描画される
// （画面上端付近ではビューポート外に出て押せなくなる）。
// 見た目には出にくい壊れ方なので、ref が届くことだけを直接押さえておく。

import { describe, it, expect, afterEach } from "vitest";
afterEach(() => cleanup());
import { createRef } from "react";
import { render, cleanup } from "@testing-library/react";
import { ShadCNDefaultComponents } from "@blocknote/shadcn";
import { blockNoteShadCNComponents } from "./blocknote-shadcn-overrides";

const Button = blockNoteShadCNComponents.Button.Button;

describe("blockNoteShadCNComponents.Button", () => {
  it("ref が実際の button 要素に届く", () => {
    const ref = createRef<HTMLButtonElement>();
    // 型上は React 18 の shadcn Button（ref を受け取れない）なので cast して渡す。
    const { getByText } = render(
      <Button {...({ ref } as any)}>ハンドル</Button>,
    );

    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current).toBe(getByText("ハンドル").closest("button"));
  });

  it("className・任意の属性・イベントハンドラを実 button に引き継ぐ", () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button
        {...({ ref } as any)}
        className="bn-table-handle"
        draggable
        aria-label="列ハンドル"
      >
        ⠿
      </Button>,
    );

    const button = ref.current!;
    expect(button.className).toContain("bn-table-handle");
    expect(button.getAttribute("draggable")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe("列ハンドル");
  });

  it("render 指定時は呼び出し側の要素をそのまま使う", () => {
    const { getByTestId } = render(
      <Button render={<a href="#x" data-testid="as-child" />} className="bn-table-handle">
        リンク
      </Button>,
    );

    const el = getByTestId("as-child");
    expect(el.tagName).toBe("A");
    expect(el.className).toContain("bn-table-handle");
  });
});

describe("blockNoteShadCNComponents.Toggle", () => {
  it("ref が実際の button 要素に届く", () => {
    const Toggle = blockNoteShadCNComponents.Toggle.Toggle;
    const ref = createRef<HTMLButtonElement>();
    const { getByText } = render(
      <Toggle {...({ ref } as any)} aria-label="太字">
        B
      </Toggle>,
    );

    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current).toBe(getByText("B").closest("button"));
  });
});

// Popover は 0.53 から本家が base-ui の Portal で出す（差し替えなし）。
// Graphium 側で押さえるのは「制御された open を勝手に閉じない」ことだけ
describe("ShadCN Popover（本家）", () => {
  it("Portal 先の入力欄の操作はツールバー側の閉じ判定（frozen）に依存し、小窓の open は外から変えない", () => {
    // BlockNote の LinkToolbarController は frozen 中はホバー起因の閉じを無視する。
    // ここでは Popover が制御された open をそのまま保つこと（勝手に閉じない）を押さえる。
    const { Popover, PopoverContent } = ShadCNDefaultComponents!.Popover;
    const { getByTestId } = render(
      <Popover open>
        <PopoverContent>
          <input data-testid="url" defaultValue="https://a" />
        </PopoverContent>
      </Popover>,
    );
    const input = getByTestId("url") as HTMLInputElement;
    input.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    expect(document.querySelector('[data-slot="popover-content"]')).toBeTruthy();
  });
});
