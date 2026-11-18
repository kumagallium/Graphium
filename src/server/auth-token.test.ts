// 合言葉の取り込み（デスクトップ版）のテスト
// 環境変数に残すと、sidecar が起動する子プロセス（CLI・ログインシェル）に継がれてしまう

import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetCapturedAuthTokenForTest,
  captureDesktopAuthToken,
  desktopSidecarProof,
  getAuthToken,
  SIDECAR_PROOF_PREFIX,
} from "./auth-token.js";

const saved = {
  token: process.env.GRAPHIUM_AUTH_TOKEN,
  desktop: process.env.GRAPHIUM_DESKTOP,
};

function restore(key: "GRAPHIUM_AUTH_TOKEN" | "GRAPHIUM_DESKTOP", value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeEach(() => {
  __resetCapturedAuthTokenForTest();
  delete process.env.GRAPHIUM_AUTH_TOKEN;
  delete process.env.GRAPHIUM_DESKTOP;
});

afterEach(() => {
  __resetCapturedAuthTokenForTest();
  restore("GRAPHIUM_AUTH_TOKEN", saved.token);
  restore("GRAPHIUM_DESKTOP", saved.desktop);
});

describe("captureDesktopAuthToken", () => {
  it("デスクトップ版では合言葉を取り込み、環境変数から消す（照合は続けて効く）", () => {
    process.env.GRAPHIUM_DESKTOP = "1";
    process.env.GRAPHIUM_AUTH_TOKEN = "per-launch-value";
    captureDesktopAuthToken();
    expect(process.env.GRAPHIUM_AUTH_TOKEN).toBeUndefined();
    expect(getAuthToken()).toBe("per-launch-value");
    // 子プロセスへ渡す環境の写しにも残らない
    expect(Object.keys({ ...process.env })).not.toContain("GRAPHIUM_AUTH_TOKEN");
  });

  it("セルフホスト（GRAPHIUM_DESKTOP なし）では環境変数に手を付けない", () => {
    process.env.GRAPHIUM_AUTH_TOKEN = "operator-value";
    captureDesktopAuthToken();
    expect(process.env.GRAPHIUM_AUTH_TOKEN).toBe("operator-value");
    expect(getAuthToken()).toBe("operator-value");
  });

  it("合言葉が無ければ何も取り込まない", () => {
    process.env.GRAPHIUM_DESKTOP = "1";
    captureDesktopAuthToken();
    expect(getAuthToken()).toBeUndefined();
  });

  it("空文字の環境変数は未設定として扱う", () => {
    process.env.GRAPHIUM_AUTH_TOKEN = "";
    expect(getAuthToken()).toBeUndefined();
  });
});

describe("desktopSidecarProof", () => {
  const CHALLENGE = "ab".repeat(32);

  it("前置きは画面側（src/lib/api-auth-fetch.ts）と同じ値", () => {
    expect(SIDECAR_PROOF_PREFIX).toBe("graphium-sidecar-proof-v1:");
  });

  it("デスクトップ版では HMAC-SHA256(合言葉, 前置き + challenge) を返す", () => {
    process.env.GRAPHIUM_DESKTOP = "1";
    process.env.GRAPHIUM_AUTH_TOKEN = "tok-1";
    captureDesktopAuthToken();
    const expected = createHmac("sha256", "tok-1").update(SIDECAR_PROOF_PREFIX + CHALLENGE, "utf8").digest("hex");
    expect(desktopSidecarProof(CHALLENGE)).toBe(expected);
    // 合言葉そのものは含まれない
    expect(desktopSidecarProof(CHALLENGE)).not.toContain("tok-1");
  });

  it("合言葉が違えば証明も違う", () => {
    process.env.GRAPHIUM_DESKTOP = "1";
    process.env.GRAPHIUM_AUTH_TOKEN = "tok-2";
    captureDesktopAuthToken();
    const other = createHmac("sha256", "tok-1").update(SIDECAR_PROOF_PREFIX + CHALLENGE, "utf8").digest("hex");
    expect(desktopSidecarProof(CHALLENGE)).not.toBe(other);
  });

  it("セルフホスト（GRAPHIUM_DESKTOP なし）では返さない（弱い合言葉を総当たりする材料にしない）", () => {
    process.env.GRAPHIUM_AUTH_TOKEN = "weak";
    expect(desktopSidecarProof(CHALLENGE)).toBeNull();
  });

  it("合言葉が無い・challenge の形が違うときは返さない", () => {
    process.env.GRAPHIUM_DESKTOP = "1";
    expect(desktopSidecarProof(CHALLENGE)).toBeNull();
    process.env.GRAPHIUM_AUTH_TOKEN = "tok-1";
    captureDesktopAuthToken();
    for (const bad of [undefined, null, "", "abc", "AB".repeat(32), "ab".repeat(33), "zz".repeat(32)]) {
      expect(desktopSidecarProof(bad)).toBeNull();
    }
  });
});
