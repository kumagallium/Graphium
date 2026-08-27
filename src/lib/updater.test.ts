import { describe, expect, it } from "vitest";
import {
  classifyUpdaterError,
  compareVersions,
  describeDownloadAttempt,
  hitDownloadTimeout,
} from "./updater";

describe("classifyUpdaterError", () => {
  it("reqwest の decode エラーをネットワーク扱いにする", () => {
    // Windows ユーザーから実際に報告された文字列。プロキシ・セキュリティソフトの
    // 割り込みやダウンロード中の切断が、すべてこの一文にまとめられる
    const info = classifyUpdaterError(new Error("error decoding response body"));
    expect(info.key).toBe("updater.errorNetwork");
    expect(info.offerManualDownload).toBe(true);
    expect(info.raw).toBe("error decoding response body");
  });

  it("送信失敗・タイムアウト・HTTP エラーもネットワーク扱いにする", () => {
    for (const message of [
      "error sending request for url (https://example.com)",
      "operation timed out",
      "`Download request failed with status: 404 Not Found`",
      "Could not fetch a valid release JSON from the remote",
    ]) {
      expect(classifyUpdaterError(new Error(message)).key).toBe(
        "updater.errorNetwork",
      );
    }
  });

  it("署名検証の失敗は整合性エラーとして分ける", () => {
    const info = classifyUpdaterError(
      new Error("Signature verification failed: minisign"),
    );
    expect(info.key).toBe("updater.errorIntegrity");
  });

  it("分類できないものは unknown に落とし、生文字列は保つ", () => {
    const info = classifyUpdaterError("something else entirely");
    expect(info.key).toBe("updater.errorUnknown");
    expect(info.raw).toBe("something else entirely");
  });
});

describe("compareVersions", () => {
  it("数値として比較する（文字列比較にしない）", () => {
    expect(compareVersions("0.45.10", "0.45.9")).toBeGreaterThan(0);
    expect(compareVersions("0.46.0", "0.45.4")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.45.4", "0.45.4")).toBe(0);
    expect(compareVersions("0.45.3", "0.45.4")).toBeLessThan(0);
  });

  it("先頭の v を無視する", () => {
    expect(compareVersions("v0.45.5", "0.45.4")).toBeGreaterThan(0);
  });

  it("解釈できない入力は 0（更新なし扱い）にする", () => {
    // 誤って「新版がある」と案内しないための保険
    expect(compareVersions("not-a-version", "0.45.4")).toBe(0);
    expect(compareVersions("0.45.4", "")).toBe(0);
  });
});

describe("describeDownloadAttempt / hitDownloadTimeout", () => {
  const timeoutMs = 30 * 60 * 1000;

  it("制限時間まで粘った末の失敗は timeout と読む", () => {
    const stats = {
      downloaded: 12 * 1024 * 1024,
      total: 41.9 * 1024 * 1024,
      elapsedMs: timeoutMs,
      timeoutMs,
    };
    expect(hitDownloadTimeout(stats)).toBe(true);
    expect(describeDownloadAttempt(stats)).toContain("timeout");
  });

  it("早々に落ちた失敗は interrupted と読む", () => {
    const stats = {
      downloaded: 3 * 1024 * 1024,
      total: 41.9 * 1024 * 1024,
      elapsedMs: 12_000,
      timeoutMs,
    };
    expect(hitDownloadTimeout(stats)).toBe(false);
    // reqwest の一文だけでは分からない「どこまで届いたか」を残す
    expect(describeDownloadAttempt(stats)).toBe(
      "download: 3.0 / 41.9 MB in 12s (limit 1800s) — interrupted",
    );
  });

  it("Content-Length が無い応答でも診断行を作れる", () => {
    const line = describeDownloadAttempt({
      downloaded: 1024 * 1024,
      elapsedMs: 5_000,
      timeoutMs,
    });
    expect(line).toBe("download: 1.0 MB in 5s (limit 1800s) — interrupted");
  });

  it("実測を渡すと分類結果に detail が付く", () => {
    const info = classifyUpdaterError(new Error("error decoding response body"), {
      downloaded: 0,
      elapsedMs: 1_000,
      timeoutMs,
    });
    expect(info.key).toBe("updater.errorNetwork");
    expect(info.detail).toContain("download:");
  });
});
