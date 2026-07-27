// @vitest-environment jsdom
// push 設定（client_id の解決とフォルダ ID キャッシュ）のテスト。
// 対象の不変条件:
// - client_id は「自前上書き → 同梱デフォルト」の順で解決し、どちらも空なら null
//   （= isConfigured()=false で UI が設定案内を出せる）
// - 上書きの解除（null/空文字）でデフォルトに戻る
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
  it("returns null while the bundled default is a placeholder and no override is set", () => {
    // 同梱デフォルトは発行待ちのプレースホルダ（空文字）である前提のテスト。
    // 発行後にデフォルトを埋めたらこのテストは書き換えること。
    expect(DEFAULT_GOOGLE_PUSH_CLIENT_ID).toBe("");
    expect(getGoogleClientId()).toBeNull();
  });

  it("uses the localStorage override as a first-class source", () => {
    setGoogleClientIdOverride("  my-client-id.apps.googleusercontent.com  ");
    expect(getGoogleClientIdOverride()).toBe("my-client-id.apps.googleusercontent.com");
    expect(getGoogleClientId()).toBe("my-client-id.apps.googleusercontent.com");
  });

  it("clears the override with null or an empty string", () => {
    setGoogleClientIdOverride("some-id");
    setGoogleClientIdOverride(null);
    expect(getGoogleClientIdOverride()).toBeNull();
    expect(getGoogleClientId()).toBeNull();

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
