// @vitest-environment jsdom
// アプリ全体のエラーバウンダリ: 描画中・effect の例外で画面が真っ白にならず、
// 再読み込みの入口とエラーの中身が出て、端末に残ること

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { LocaleProvider, t } from "../i18n";
import { AppErrorBoundary, LAST_CRASH_KEY, formatCrash } from "./app-error-boundary";

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  // React が捕まえたエラーを console.error に出すので、テストの出力を汚さない
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function ThrowInRender(): never {
  throw new Error("boom in render");
}

function ThrowInEffect() {
  useEffect(() => {
    throw new Error("boom in effect");
  }, []);
  return <p>ok</p>;
}

const mount = (child: React.ReactNode) =>
  render(
    <LocaleProvider>
      <AppErrorBoundary>{child}</AppErrorBoundary>
    </LocaleProvider>,
  );

describe("AppErrorBoundary", () => {
  it("例外が無ければ子をそのまま描く", () => {
    mount(<p>hello</p>);
    expect(document.body.textContent).toContain("hello");
  });

  it("描画中の例外で、真っ白ではなく再読み込みとエラーの中身を出す", () => {
    mount(<ThrowInRender />);
    const s = document.body.textContent ?? "";
    expect(s).toContain(t("crash.title"));
    expect(s).toContain(t("startup.reload"));
    expect(s).toContain("boom in render");
  });

  it("effect の例外も受け、内容を端末に残す", () => {
    mount(<ThrowInEffect />);
    expect(document.body.textContent).toContain(t("crash.title"));
    const saved = JSON.parse(localStorage.getItem(LAST_CRASH_KEY) ?? "null");
    expect(saved?.message).toBe("boom in effect");
    expect(saved?.componentStack).toContain("ThrowInEffect");
  });

  it("formatCrash は時刻・メッセージ・場所・スタックを 1 つにまとめる", () => {
    const s = formatCrash({ at: "2026-11-24T00:00:00Z", message: "m", location: "#note/x", stack: "S", componentStack: "C" });
    expect(s).toContain("2026-11-24T00:00:00Z m");
    expect(s).toContain("at #note/x");
    expect(s).toContain("S");
    expect(s).toContain("Component stack:C");
  });
});
