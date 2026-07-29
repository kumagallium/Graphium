// @vitest-environment jsdom
// デスクトップ設定の「接続はスマホ側で」案内カードのテスト。
//
// 対象の不変条件:
// - 接続/切断ボタンを持たない（デスクトップで接続してもスマホには効かず、
//   Tauri の WebView では GIS のポップアップが必ず失敗する — 実バグの再発防止）
// - QR は外部リクエスト無しでその場に描かれる（Tauri のオフライン環境でも出る）
// - URL はテキストでも読めて、コピーできる
//
// 文言は LocaleProvider の既定（jsdom の navigator.language → en）で照合する。

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MobileConnectQrCard } from "./MobileConnectQrCard";
import { LocaleProvider } from "../../../i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const URL_UNDER_TEST = "https://kumagallium.github.io/Graphium/app/";

afterEach(() => {
  cleanup();
});

function renderCard(url = URL_UNDER_TEST) {
  return render(
    <LocaleProvider>
      <MobileConnectQrCard url={url} />
    </LocaleProvider>,
  );
}

describe("MobileConnectQrCard", () => {
  it("guides the user to connect on the phone instead of offering a Connect button", () => {
    renderCard();
    expect(screen.getByText("Connect on your phone")).toBeTruthy();
    // 接続/切断はスマホ側の仕事 — デスクトップには置かない
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
  });

  it("renders the QR locally as inline SVG (no external request, works offline in Tauri)", () => {
    const { container } = renderCard();
    const svg = container.querySelector("[data-testid='mobile-connect-qr-code'] svg");
    expect(svg).toBeTruthy();
    // 画像 API / CDN 経由ではない = img も外部 URL も無い
    expect(container.querySelector("img")).toBeNull();
    expect(svg?.querySelector("title")?.textContent).toBe(URL_UNDER_TEST);
    // 実際に符号化されている（空の svg ではない）
    expect(svg?.querySelectorAll("path").length).toBeGreaterThan(0);
  });

  it("shows the URL as text and copies it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderCard();
    expect(screen.getByTestId("mobile-connect-qr-url").textContent).toBe(URL_UNDER_TEST);
    fireEvent.click(screen.getByRole("button", { name: /Copy URL/ }));
    expect(writeText).toHaveBeenCalledWith(URL_UNDER_TEST);
    await waitFor(() => expect(screen.getByText("Copied")).toBeTruthy());
  });
});
