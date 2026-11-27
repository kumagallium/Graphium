// @vitest-environment jsdom
// push 設定（client_id の解決とフォルダ ID キャッシュ）のテスト。
// 対象の不変条件:
// - client_id は「自前上書き → 同梱デフォルト」の順で解決する。同梱デフォルトが
//   ある現在のビルドでは、上書き無し = 同梱 ID、上書きの解除 = 同梱 ID に戻る
// - フォルダキャッシュは壊れた JSON / 形の違う JSON を無害に null 扱いする
// - 選択プロバイダは未保存・不正値を google-drive に倒す（v1 の唯一の実体）
// - 送り先フォルダの履歴は新しい順・重複なし・上限あり。壊れた値は空として扱う

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  __setStayDefaultsForTest,
  DEFAULT_GOOGLE_PUSH_CLIENT_ID,
  getAuthModePreference,
  getStayConnectedConfig,
  isLegacyPushUser,
  resolveAuthMode,
  setAuthModePreference,
  getInboxFolderHistory,
  rememberInboxFolder,
  getDriveFolderCache,
  getGoogleClientId,
  getGoogleClientIdOverride,
  getPushProvider,
  setDriveFolderCache,
  setGoogleClientIdOverride,
  setPushProvider,
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
    expect(getDriveFolderCache("hourly")).toBeNull();
    setDriveFolderCache("hourly", { rootId: "root-1", inboxId: "inbox-1" });
    expect(getDriveFolderCache("hourly")).toEqual({ rootId: "root-1", inboxId: "inbox-1" });
  });

  it("clears with null (used when the folder was deleted remotely)", () => {
    setDriveFolderCache("hourly", { rootId: "root-1", inboxId: "inbox-1" });
    setDriveFolderCache("hourly", null);
    expect(getDriveFolderCache("hourly")).toBeNull();
  });

  it("treats corrupted or malformed JSON as absent", () => {
    localStorage.setItem("graphium-push-drive-folders", "{not json");
    expect(getDriveFolderCache("hourly")).toBeNull();
    localStorage.setItem("graphium-push-drive-folders", JSON.stringify({ rootId: 1 }));
    expect(getDriveFolderCache("hourly")).toBeNull();
  });
});

describe("選択プロバイダの永続", () => {
  it("defaults to google-drive while nothing is stored (v1 sole provider)", () => {
    expect(getPushProvider()).toBe("google-drive");
  });

  it("stores the picked provider and reads it back", () => {
    setPushProvider("google-drive");
    expect(localStorage.getItem("graphium-push-provider")).toBe("google-drive");
    expect(getPushProvider()).toBe("google-drive");
  });

  it("falls back to google-drive for unknown stored values (whitelist)", () => {
    localStorage.setItem("graphium-push-provider", "dropbox");
    expect(getPushProvider()).toBe("google-drive");
  });
});

describe("送り先フォルダの履歴", () => {
  it("使った順に新しいものが先頭へ来る", () => {
    rememberInboxFolder("材料X");
    rememberInboxFolder("実験B");
    expect(getInboxFolderHistory()).toEqual(["実験B", "材料X"]);
  });

  it("同じフォルダを使い直しても増えず、先頭へ上がる", () => {
    rememberInboxFolder("材料X");
    rememberInboxFolder("実験B");
    rememberInboxFolder("材料X");
    expect(getInboxFolderHistory()).toEqual(["材料X", "実験B"]);
  });

  it("前後の空白は落とす。空文字は覚えない", () => {
    rememberInboxFolder("  材料X  ");
    rememberInboxFolder("   ");
    expect(getInboxFolderHistory()).toEqual(["材料X"]);
  });

  it("上限を超えたら古いものから落ちる", () => {
    for (let i = 0; i < 15; i++) rememberInboxFolder(`folder${i}`);
    const history = getInboxFolderHistory();
    expect(history).toHaveLength(12);
    expect(history[0]).toBe("folder14");
    expect(history).not.toContain("folder0");
  });

  it("壊れた JSON / 形の違う JSON は空として扱う", () => {
    localStorage.setItem("graphium-mobile-inbox-folder-history", "{");
    expect(getInboxFolderHistory()).toEqual([]);
    localStorage.setItem("graphium-mobile-inbox-folder-history", JSON.stringify({ a: 1 }));
    expect(getInboxFolderHistory()).toEqual([]);
    localStorage.setItem("graphium-mobile-inbox-folder-history", JSON.stringify(["ok", 3, null]));
    expect(getInboxFolderHistory()).toEqual(["ok"]);
  });
});

describe("stay（つないだまま）の設定と方式の解決", () => {
  const STAY = { clientId: "stay-client", brokerUrl: "https://broker.example.workers.dev/" };

  beforeEach(() => {
    __setStayDefaultsForTest(null);
  });
  afterEach(() => {
    __setStayDefaultsForTest(null);
  });

  it("stay is unavailable while the bundled constants are empty (same as before)", () => {
    __setStayDefaultsForTest({ clientId: "", brokerUrl: "" });
    expect(getStayConnectedConfig()).toBeNull();
    expect(resolveAuthMode()).toBe("hourly");
  });

  it("getStayConnectedConfig strips the trailing slash and requires both constants", () => {
    __setStayDefaultsForTest(STAY);
    expect(getStayConnectedConfig()).toEqual({
      clientId: "stay-client",
      brokerUrl: "https://broker.example.workers.dev",
    });
    __setStayDefaultsForTest({ clientId: "stay-client", brokerUrl: "" });
    expect(getStayConnectedConfig()).toBeNull();
    __setStayDefaultsForTest({ clientId: "", brokerUrl: "https://b.example" });
    expect(getStayConnectedConfig()).toBeNull();
  });

  it("a custom client_id override disables stay (hourly even with a stay preference)", () => {
    __setStayDefaultsForTest(STAY);
    setAuthModePreference("stay");
    setGoogleClientIdOverride("my-own-client");
    expect(getStayConnectedConfig()).toBeNull();
    expect(resolveAuthMode()).toBe("hourly");
  });

  it("a saved preference wins", () => {
    __setStayDefaultsForTest(STAY);
    setAuthModePreference("hourly");
    expect(resolveAuthMode()).toBe("hourly");
    setAuthModePreference("stay");
    expect(resolveAuthMode()).toBe("stay");
    setAuthModePreference(null);
    expect(getAuthModePreference()).toBeNull();
  });

  it("a new user (no preference, no hourly traces) gets stay", () => {
    __setStayDefaultsForTest(STAY);
    expect(isLegacyPushUser()).toBe(false);
    expect(resolveAuthMode()).toBe("stay");
  });

  it("an existing user (hourly folder cache or token) stays on hourly and the mark is pinned", () => {
    __setStayDefaultsForTest(STAY);
    localStorage.setItem("graphium-push-drive-folders", JSON.stringify({ rootId: "r", inboxId: "i" }));
    expect(resolveAuthMode()).toBe("hourly");
    // 印が固定されるので、キャッシュを消しても判定は変わらない
    localStorage.removeItem("graphium-push-drive-folders");
    expect(resolveAuthMode()).toBe("hourly");

    localStorage.clear();
    localStorage.setItem("graphium-push-google-token", JSON.stringify({ accessToken: "x", expiresAt: 1 }));
    expect(resolveAuthMode()).toBe("hourly");
  });

  it("writing the hourly folder cache marks the user as legacy; the stay cache does not", () => {
    setDriveFolderCache("stay", { rootId: "r", inboxId: "i" });
    expect(isLegacyPushUser()).toBe(false);
    setDriveFolderCache("hourly", { rootId: "r", inboxId: "i" });
    expect(isLegacyPushUser()).toBe(true);
  });

  it("an existing user can opt in to stay explicitly", () => {
    __setStayDefaultsForTest(STAY);
    localStorage.setItem("graphium-push-legacy-user", "1");
    setAuthModePreference("stay");
    expect(resolveAuthMode()).toBe("stay");
  });

  it("folder caches are separate per mode", () => {
    setDriveFolderCache("hourly", { rootId: "h-r", inboxId: "h-i" });
    setDriveFolderCache("stay", { rootId: "s-r", inboxId: "s-i" });
    expect(getDriveFolderCache("hourly")).toEqual({ rootId: "h-r", inboxId: "h-i" });
    expect(getDriveFolderCache("stay")).toEqual({ rootId: "s-r", inboxId: "s-i" });
    setDriveFolderCache("stay", null);
    expect(getDriveFolderCache("stay")).toBeNull();
    expect(getDriveFolderCache("hourly")).not.toBeNull();
  });
});
