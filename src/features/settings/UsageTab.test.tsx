// @vitest-environment jsdom
// 設定 › 使用量タブのテスト。
//
// GET /api/usage の応答を受け取り口で揃えていることの回帰防止。raw / summary が
// 配列でない 200（Storybook の API スタブが `{}` を返していた）を受けると、以前は
// 集計の `for (const ev of raw)` が描画中に `raw is not iterable` で落ちていた。
//
// 文言は LocaleProvider の既定（jsdom の navigator.language → en）で照合する。

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { UsageTab } from "./UsageTab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function stubUsageResponse(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })),
  );
}

function renderTab() {
  return render(
    <LocaleProvider>
      <UsageTab />
    </LocaleProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("UsageTab", () => {
  it("raw / summary を欠いた応答でも落ちずに「記録なし」を出す", async () => {
    stubUsageResponse({});
    renderTab();
    expect(await screen.findByText("No AI calls recorded in this range yet.")).toBeTruthy();
  });

  it("raw / summary が配列でない応答でも落ちずに「記録なし」を出す", async () => {
    stubUsageResponse({ raw: null, summary: "oops", mode: "node" });
    renderTab();
    expect(await screen.findByText("No AI calls recorded in this range yet.")).toBeTruthy();
  });

  it("記録があれば合計に反映する", async () => {
    stubUsageResponse({
      raw: [
        {
          ts: new Date().toISOString(),
          feature: "agent.chat",
          provider: "anthropic",
          modelId: "claude-sonnet-5",
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          cost: 0.5,
          costCurrency: "usd",
        },
      ],
      summary: [],
      mode: "node",
    });
    renderTab();
    // 合計と機能別の行の両方に出る
    expect((await screen.findAllByText("1.5K")).length).toBeGreaterThan(0);
    expect(screen.queryByText("No AI calls recorded in this range yet.")).toBeNull();
  });
});
