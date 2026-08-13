// @vitest-environment jsdom
// 差し替えた shadcn Button が ref を実 DOM まで通すことの回帰テスト。
//
// ここが壊れると Radix Popper の anchor が null になり、テーブルハンドルや
// ドラッグハンドルのメニューが「一度も配置されない」状態で描画される
// （画面上端付近ではビューポート外に出て押せなくなる）。
// 見た目には出にくい壊れ方なので、ref が届くことだけを直接押さえておく。

import { describe, it, expect } from "vitest";
import { createRef } from "react";
import { render } from "@testing-library/react";
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

  it("asChild 指定時は呼び出し側の要素をそのまま使う", () => {
    const { getByTestId } = render(
      <Button asChild className="bn-table-handle">
        <a href="#x" data-testid="as-child">リンク</a>
      </Button>,
    );

    const el = getByTestId("as-child");
    expect(el.tagName).toBe("A");
    expect(el.className).toContain("bn-table-handle");
  });
});
