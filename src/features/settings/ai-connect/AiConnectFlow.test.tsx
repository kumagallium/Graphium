// @vitest-environment jsdom
// つなぎ先を選んで登録するまで（AiConnectFlow）の回帰ガード
//
// IT に詳しくない人がつまずかないよう、URL やモデルを自分で選ばずに登録できることを見る:
// 接続先を選ぶ → キーを貼る → 自動で確かめる → ふだん使いのモデルが選ばれている → 追加する

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// 言語は i18n を読み込んだ時点で決まるので、読み込みより前に日本語にしておく
vi.hoisted(() => localStorage.setItem("graphium_locale", "ja"));
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../../../i18n";
import { AiConnectFlow, type AiConnectFlowProps } from "./AiConnectFlow";

function setup(overrides: Partial<AiConnectFlowProps> = {}) {
  const props: AiConnectFlowProps = {
    onPickCustom: vi.fn(),
    fetchModels: vi.fn(async () => ["text-embedding-3-large", "gpt-4o", "gpt-5.6-luna", "dall-e-3"]),
    addModel: vi.fn(async () => {}),
    openExternal: vi.fn(),
    comparisonUrl: "https://example.test/compare",
    ...overrides,
  };
  render(
    <LocaleProvider>
      <AiConnectFlow {...props} />
    </LocaleProvider>,
  );
  return props;
}

const openCloud = () => fireEvent.click(screen.getByText("API キーでつなぐ（クラウドのサービス）"));
const connectTo = (name: string) => {
  const card = screen.getByText(name).closest("div.rounded-lg") as HTMLElement;
  fireEvent.click([...card.querySelectorAll("button")].find((b) => b.textContent?.includes("接続する"))!);
};

describe("AiConnectFlow", () => {
  beforeEach(() => {
    localStorage.setItem("graphium_locale", "ja");
  });
  afterEach(() => cleanup());

  it("キーを貼ると自動で確かめ、チャット用のふだん使いのモデルを選んで登録する（URL は既定のまま）", async () => {
    const props = setup();
    openCloud();
    connectTo("OpenAI");
    fireEvent.change(screen.getByPlaceholderText("ここにキーを貼ってください"), { target: { value: "sk-test-123456" } });
    await waitFor(() => expect(screen.getByText(/つながりました/)).toBeTruthy(), { timeout: 3000 });
    expect(props.fetchModels).toHaveBeenCalledWith("openai", "sk-test-123456", "");
    fireEvent.click(screen.getByText("追加する"));
    await waitFor(() =>
      expect(props.addModel).toHaveBeenCalledWith({
        name: "gpt-5.6-luna",
        provider: "openai",
        modelId: "gpt-5.6-luna",
        apiKey: "sk-test-123456",
        apiBase: "",
      }),
    );
  });

  it("OpenAI 互換の接続先は URL を入力済みにし、カタログのモデルを選ぶ", async () => {
    const props = setup({ fetchModels: vi.fn(async () => ["openai/other", "openai/gpt-oss-120b:free"]) });
    openCloud();
    connectTo("OpenRouter");
    fireEvent.change(screen.getByPlaceholderText("ここにキーを貼ってください"), { target: { value: "or-test-key" } });
    await waitFor(() => expect(screen.getByText(/openai\/gpt-oss-120b:free を使います/)).toBeTruthy(), { timeout: 3000 });
    expect(props.fetchModels).toHaveBeenCalledWith("openai-compatible", "or-test-key", "https://openrouter.ai/api/v1");
  });

  it("Cloudflare はアカウント ID を入れるまで確かめに行かず、入れると URL を埋める", async () => {
    const props = setup({ fetchModels: vi.fn(async () => ["@cf/openai/gpt-oss-120b"]) });
    openCloud();
    connectTo("Cloudflare Workers AI");
    fireEvent.change(screen.getByPlaceholderText("ここにキーを貼ってください"), { target: { value: "cf-token" } });
    await new Promise((r) => setTimeout(r, 900));
    expect(props.fetchModels).not.toHaveBeenCalled();
    fireEvent.change(screen.getByText("アカウント ID").parentElement!.querySelector("input")!, { target: { value: "abc123" } });
    await waitFor(() =>
      expect(props.fetchModels).toHaveBeenCalledWith(
        "openai-compatible",
        "cf-token",
        "https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1",
      ),
    { timeout: 3000 });
  });

  it("キーが違うと理由を出し、「追加する」は押せない", async () => {
    setup({ fetchModels: vi.fn(async () => { throw new Error("キーが正しくないようです"); }) });
    openCloud();
    connectTo("Anthropic");
    fireEvent.change(screen.getByPlaceholderText("ここにキーを貼ってください"), { target: { value: "bad-key" } });
    await waitFor(() => expect(screen.getByText(/キーが正しくないようです/)).toBeTruthy(), { timeout: 3000 });
    expect((screen.getByText("追加する") as HTMLButtonElement).disabled).toBe(true);
  });

  it("無料枠のあるものだけに絞れる。無料枠の無い接続先が消える", () => {
    setup();
    openCloud();
    expect(screen.queryByText("OpenAI")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("無料枠のあるものだけ表示"));
    expect(screen.queryByText("OpenAI")).toBeNull();
    expect(screen.queryByText("Anthropic")).toBeNull();
    expect(screen.queryByText("OpenRouter")).toBeTruthy();
  });

  it("登録済みの接続先があれば一番上に出し、押すとその接続先を返す", () => {
    const onPickExisting = vi.fn();
    setup({ existingGroups: [{ id: "m1", label: "OpenAI" }], onPickExisting });
    fireEvent.click(screen.getByText("登録済みの接続先にモデルを足す").parentElement!.querySelector("button")!);
    expect(onPickExisting).toHaveBeenCalledWith("m1");
  });

  it("GitHub の行は、接続を始められるとき（デスクトップ）だけ出し、学習の告知を添える", () => {
    const onConnectCopilot = vi.fn();
    setup({ onConnectCopilot });
    expect(screen.getByText("GitHub アカウントで使う")).toBeTruthy();
    expect(screen.getByText(/学習に使われることがあります/)).toBeTruthy();
  });

  it("ブラウザ版（接続を始められない）では GitHub の行を出さない", () => {
    setup();
    expect(screen.queryByText("GitHub アカウントで使う")).toBeNull();
  });

  it("一覧から選ぶと入力欄を見える位置に戻す（開いた直後は動かさない）", () => {
    const scroll = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      setup();
      openCloud();
      expect(scroll).not.toHaveBeenCalled();
      // 一覧の下の方を選ぶと中身が縮んで、入力欄が画面の上に外れていた
      connectTo("さくらのAI Engine");
      expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});
