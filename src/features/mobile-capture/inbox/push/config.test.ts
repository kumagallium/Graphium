// @vitest-environment jsdom
// push 設定（client_id の解決とフォルダ ID キャッシュ）のテスト。
// 対象の不変条件:
// - client_id は「自前上書き → 同梱デフォルト」の順で解決する。同梱デフォルトが
//   ある現在のビルドでは、上書き無し = 同梱 ID、上書きの解除 = 同梱 ID に戻る
// - フォルダキャッシュは壊れた JSON / 形の違う JSON を無害に null 扱いする

import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_GOOGLE_PUSH_CLIENT_ID,
  getDriveFolderCache,
  getGoogleClientId,
  getGoogleClientIdOverride,
  setDriveFolderCache,
  setGoogleClientIdOverride,
} from "./config";

beforeEach(() => {
  localStorage.clear();
});

describe("client_id の解決", () => {
  it("falls back to the bundled default when no override is set", () => {
    // 同梱デフォルトは旧 Google Drive 連携から引き継いだ Web クライアント ID。
    // 形だけ検証して、解決結果がそのままデフォルトになることを確認する。
    expect(DEFAULT_GOOGLE_PUSH_CLIENT_ID).toMatch(/\.apps\.googleusercontent\.com$/);
    expect(getGoogleClientId()).toBe(DEFAULT_GOOGLE_PUSH_CLIENT_ID);
  });

  it("uses the localStorage override as a first-class source", () => {
    setGoogleClientIdOverride("  my-client-id.apps.googleusercontent.com  ");
    expect(getGoogleClientIdOverride()).toBe("my-client-id.apps.googleusercontent.com");
    expect(getGoogleClientId()).toBe("my-client-id.apps.googleusercontent.com");
  });

  it("clears the override with null or an empty string, returning to the default", () => {
    setGoogleClientIdOverride("some-id");
    setGoogleClientIdOverride(null);
    expect(getGoogleClientIdOverride()).toBeNull();
    expect(getGoogleClientId()).toBe(DEFAULT_GOOGLE_PUSH_CLIENT_ID);

    setGoogleClientIdOverride("some-id");
    setGoogleClientIdOverride("   ");
    expect(getGoogleClientIdOverride()).toBeNull();
  });
});

describe("Drive フォルダ ID キャッシュ", () => {
  it("stores and restores the folder ids", () => {
    expect(getDriveFolderCache()).toBeNull();
    setDriveFolderCache({ rootId: "root-1", inboxId: "inbox-1" });
    expect(getDriveFolderCache()).toEqual({ rootId: "root-1", inboxId: "inbox-1" });
  });

  it("clears with null (used when the folder was deleted remotely)", () => {
    setDriveFolderCache({ rootId: "root-1", inboxId: "inbox-1" });
    setDriveFolderCache(null);
    expect(getDriveFolderCache()).toBeNull();
  });

  it("treats corrupted or malformed JSON as absent", () => {
    localStorage.setItem("graphium-push-drive-folders", "{not json");
    expect(getDriveFolderCache()).toBeNull();
    localStorage.setItem("graphium-push-drive-folders", JSON.stringify({ rootId: 1 }));
    expect(getDriveFolderCache()).toBeNull();
  });
});
