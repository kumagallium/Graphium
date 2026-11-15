import { describe, expect, it } from "vitest";
import { isOpenInAppBlockedError, openInAppFailureKey } from "./open-in-app";

describe("openInAppFailureKey", () => {
  it("Rust が実行ファイルの拡張子で断ったときは専用の文言にする", () => {
    // Tauri の invoke は Err(String) を文字列のまま reject する
    expect(isOpenInAppBlockedError("blocked-executable-type:bat")).toBe(true);
    expect(openInAppFailureKey("blocked-executable-type:exe")).toBe("asset.openInAppBlocked");
  });

  it("それ以外の失敗は従来の文言", () => {
    expect(openInAppFailureKey("アプリで開けませんでした: x")).toBe("asset.openInAppFailed");
    expect(openInAppFailureKey(new Error("boom"))).toBe("asset.openInAppFailed");
    expect(openInAppFailureKey(undefined)).toBe("asset.openInAppFailed");
  });
});
