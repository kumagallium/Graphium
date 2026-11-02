// @vitest-environment jsdom
// MemoComposer の送信の成否の扱いのテスト。
//
// 対象の不変条件:
// - 送信が成功したら欄を空にする
// - 送信が失敗（onSubmit が reject）したら、書いた文を消さずに残す。未処理の reject にもしない
//   （失敗の知らせは呼び出し側の役目。書く欄は文を残して、すぐ送り直せるようにする）
// 文言は LocaleProvider の既定（jsdom → en）で照合する。

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { MemoComposer } from "./MemoComposer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

function type(text: string) {
  const box = screen.getByRole("textbox") as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
  return box;
}

describe("MemoComposer の送信", () => {
  it("成功したら欄を空にする", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <LocaleProvider>
        <MemoComposer onSubmit={onSubmit} />
      </LocaleProvider>,
    );
    const box = type("書いた文");
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("書いた文"));
    await waitFor(() => expect(box.value).toBe(""));
  });

  it("失敗（reject）したら、書いた文を残す", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("save failed"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    render(
      <LocaleProvider>
        <MemoComposer onSubmit={onSubmit} />
      </LocaleProvider>,
    );
    const box = type("消えてほしくない文");
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(box.disabled).toBe(false));
    expect(box.value).toBe("消えてほしくない文");
    // 続けて送り直せる
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 10));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
