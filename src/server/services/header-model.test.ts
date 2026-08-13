import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config/models.js", () => ({
  getDefaultModel: vi.fn(),
  listModels: vi.fn(),
  getServerMode: vi.fn(() => "node"),
}));

import { resolveModelConfig } from "./header-model.js";
import { getDefaultModel, listModels } from "../config/models.js";

// 課金 anthropic モデルが配列先頭（= getDefaultModel）、サブスクモデルが後ろ、という構成。
// 今回のバグはここで「選択モデル不一致 → 黙って先頭の課金モデルに落ちる」だった。
const anthropic = {
  id: "1",
  name: "claude-opus-4-7",
  provider: "anthropic",
  modelId: "claude-opus-4-7",
  apiKey: "key",
  createdAt: "",
} as never;
const subscription = {
  id: "2",
  name: "Copilot-default",
  provider: "copilot-subscription",
  modelId: "default",
  apiKey: "",
  createdAt: "",
} as never;

function fakeCtx(headers: Record<string, string> = {}) {
  return { req: { header: (k: string) => headers[k] } } as never;
}

describe("resolveModelConfig — silent fallback の解消", () => {
  beforeEach(() => {
    vi.mocked(getDefaultModel).mockReturnValue(anthropic);
    vi.mocked(listModels).mockReturnValue([anthropic, subscription]);
  });

  it("指定モデルが存在すればそれを返す（サブスクを選んだらサブスクのまま）", () => {
    const cfg = resolveModelConfig(fakeCtx(), { modelName: "Copilot-default" });
    expect(cfg?.name).toBe("Copilot-default");
    expect(cfg?.provider).toBe("copilot-subscription");
  });

  it("指定モデルが見つからない場合、先頭の課金モデルへ黙って落とさず undefined を返す", () => {
    const cfg = resolveModelConfig(fakeCtx(), { modelName: "removed-model" });
    expect(cfg).toBeUndefined();
  });

  it("modelName 未指定なら従来通りデフォルト（先頭）を返す", () => {
    const cfg = resolveModelConfig(fakeCtx());
    expect(cfg?.name).toBe("claude-opus-4-7");
  });
});
