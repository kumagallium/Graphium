// @vitest-environment jsdom
// 共有ストレージ設定（localStorage）のテスト。
// 対象の不変条件:
// - 共有 AI 参照は既定 ON（共有ルートを繋ぐこと自体がオプトインだから）
// - 共有コピーへの AI チャット / 編集来歴の同梱は既定 OFF（見せるのは本文）
// - どちらも「未設定 = 既定」「明示的に書いた値だけが既定を外す」

import { describe, it, expect, beforeEach } from "vitest";
import {
  getSharedAiEnabled,
  setSharedAiEnabled,
  getShareIncludesPrivateHistory,
  setShareIncludesPrivateHistory,
} from "./config";

beforeEach(() => {
  localStorage.clear();
});

describe("共有コピーに AI チャットと編集来歴を含めるか", () => {
  it("未設定なら false（既定は含めない）", () => {
    expect(getShareIncludesPrivateHistory()).toBe(false);
  });

  it("true を書けば true、false に戻せば false", () => {
    setShareIncludesPrivateHistory(true);
    expect(getShareIncludesPrivateHistory()).toBe(true);

    setShareIncludesPrivateHistory(false);
    expect(getShareIncludesPrivateHistory()).toBe(false);
  });

  it("localStorage には \"1\" / \"0\" で書かれる", () => {
    setShareIncludesPrivateHistory(true);
    expect(localStorage.getItem("graphium-share-include-private-history")).toBe("1");
    setShareIncludesPrivateHistory(false);
    expect(localStorage.getItem("graphium-share-include-private-history")).toBe("0");
  });

  it("知らない値が入っていても既定（含めない）に倒す", () => {
    localStorage.setItem("graphium-share-include-private-history", "yes");
    expect(getShareIncludesPrivateHistory()).toBe(false);
  });

  it("共有 AI 参照の設定とは独立している", () => {
    setShareIncludesPrivateHistory(true);
    expect(getSharedAiEnabled()).toBe(true); // 既定 ON のまま

    setSharedAiEnabled(false);
    expect(getShareIncludesPrivateHistory()).toBe(true); // 巻き添えで戻らない
  });
});

describe("共有ライブラリを AI の対象に含めるか", () => {
  it("未設定なら true（既定は ON）", () => {
    expect(getSharedAiEnabled()).toBe(true);
  });

  it("false を書けば false、true に戻せば true", () => {
    setSharedAiEnabled(false);
    expect(getSharedAiEnabled()).toBe(false);
    setSharedAiEnabled(true);
    expect(getSharedAiEnabled()).toBe(true);
  });
});
