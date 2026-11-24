// @vitest-environment jsdom
// まだ何もつないでいないときの簡易表示（AiConnectFlow の simpleFirst）の回帰ガード
//
// 守ること: 最初は 1 問だけ・答えごとにボタン 1 つ・どの答えからも今の画面全体へ行ける（機能を消さない）

import { describe, it, expect, afterEach, vi } from "vitest";

vi.hoisted(() => localStorage.setItem("graphium_locale", "ja"));
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LocaleProvider } from "../../../i18n";
import { AiConnectFlow, type AiConnectFlowProps } from "./AiConnectFlow";

afterEach(cleanup);

function setup(overrides: Partial<AiConnectFlowProps> = {}) {
  const props: AiConnectFlowProps = {
    onPickCustom: vi.fn(),
    fetchModels: vi.fn(async () => []),
    addModel: vi.fn(async () => {}),
    openExternal: vi.fn(),
    comparisonUrl: "https://example.test/compare",
    importModels: vi.fn(async () => {}),
    onOpenDesktopDownload: vi.fn(),
    simpleFirst: true,
    ...overrides,
  };
  render(
    <LocaleProvider>
      <AiConnectFlow {...props} />
    </LocaleProvider>,
  );
  return props;
}

const choose = (label: string | RegExp) => fireEvent.click(screen.getByRole("radio", { name: label }));

describe("簡易表示（simpleFirst）", () => {
  it("最初は 1 問だけを出し、今の選択画面は出さない", () => {
    setup();
    expect(screen.getByText("いま使っている AI はありますか？")).toBeTruthy();
    expect(screen.queryByText("API キーでつなぐ（クラウドのサービス）")).toBeNull();
  });

  it("simpleFirst が無ければ、今までどおり選択画面から始まる", () => {
    setup({ simpleFirst: false });
    expect(screen.getByText("API キーでつなぐ（クラウドのサービス）")).toBeTruthy();
    expect(screen.queryByText("いま使っている AI はありますか？")).toBeNull();
  });

  it("デスクトップ版で ChatGPT を選ぶと、そのボタン 1 つで今の接続の流れを始める", () => {
    const onConnectChatGpt = vi.fn();
    setup({ onConnectChatGpt });
    choose(/ChatGPT の有料プラン/);
    fireEvent.click(screen.getByRole("button", { name: "Continue with ChatGPT" }));
    expect(onConnectChatGpt).toHaveBeenCalledTimes(1);
  });

  it("Web 版で ChatGPT・Copilot を選ぶと、デスクトップ版の入手先へ案内する", () => {
    const props = setup();
    choose(/ChatGPT の有料プラン/);
    fireEvent.click(screen.getByRole("button", { name: "デスクトップ版を入手" }));
    choose("GitHub Copilot");
    fireEvent.click(screen.getByRole("button", { name: "デスクトップ版を入手" }));
    expect(props.onOpenDesktopDownload).toHaveBeenCalledTimes(2);
  });

  it("研究室・機関を選ぶと、配られたファイルの読み込みを先に出し、URL の入力も残す", () => {
    const props = setup();
    choose("研究室・機関から渡された接続先");
    fireEvent.click(screen.getByRole("button", { name: "配られたファイルを読み込む" }));
    expect(screen.getByRole("heading", { name: "配られたファイルを読み込む" })).toBeTruthy();

    cleanup();
    const p2 = setup();
    choose("研究室・機関から渡された接続先");
    fireEvent.click(screen.getByRole("button", { name: "URL を入れる" }));
    expect(p2.onPickCustom).toHaveBeenCalledTimes(1);
    expect(props.onPickCustom).not.toHaveBeenCalled();
  });

  it("「すべてのつなぎ方を見る」で今の選択画面へ移り、戻ることもできる", () => {
    setup();
    fireEvent.click(screen.getByText(/すべてのつなぎ方を見る/));
    expect(screen.getByText("API キーでつなぐ（クラウドのサービス）")).toBeTruthy();
    fireEvent.click(screen.getByText(/1 問の画面に戻る/));
    expect(screen.getByText("いま使っている AI はありますか？")).toBeTruthy();
  });

  it("どれも無いを選ぶと、特定の接続先をすすめずに今の比較へ移る", () => {
    setup();
    choose("どれも無い・分からない");
    fireEvent.click(screen.getByRole("button", { name: "つなぎ方を比べる" }));
    expect(screen.getByText("API キーでつなぐ（クラウドのサービス）")).toBeTruthy();
  });
});
