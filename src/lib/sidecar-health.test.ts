// sidecar の health 応答の見分け（自分の sidecar か・再利用か入れ替えか）
//
// 不変条件:
// - dataDir が無い応答（合言葉の違う別の sidecar の最小応答）を「自分の sidecar」にしない
// - 未認証の最小応答（pid あり・dataDir なし）でも pid を取って入れ替えられる
// - 自動更新前の古い sidecar（合言葉なし・version 不一致）は入れ替える
// - pid が取れない相手は pid 0（止められない。spawn に進んで失敗の表示に任せる）

import { describe, it, expect } from "vitest";
import { isOwnSidecarHealth, judgeExistingSidecar } from "./sidecar";

const DIR = "/data/server-data";

describe("isOwnSidecarHealth", () => {
  it("dataDir があるときだけ true", () => {
    expect(isOwnSidecarHealth({ status: "healthy", dataDir: DIR })).toBe(true);
    expect(isOwnSidecarHealth({ status: "healthy", pid: 1, desktop: true })).toBe(false);
    expect(isOwnSidecarHealth({ dataDir: "" })).toBe(false);
    expect(isOwnSidecarHealth(null)).toBe(false);
    expect(isOwnSidecarHealth(undefined)).toBe(false);
    expect(isOwnSidecarHealth("x")).toBe(false);
  });
});

describe("judgeExistingSidecar", () => {
  it("dataDir・version 一致は再利用（pid を控える）", () => {
    const v = judgeExistingSidecar({ dataDir: DIR, version: "1.2.3", pid: 42 }, DIR, "1.2.3");
    expect(v).toMatchObject({ action: "reuse", pid: 42 });
  });

  it("version が取れていなければ dataDir だけで判定", () => {
    expect(judgeExistingSidecar({ dataDir: DIR, version: "0.1.0", pid: 1 }, DIR, "").action).toBe("reuse");
  });

  it("version 不一致（自動更新前の古い sidecar・合言葉なし）は入れ替え", () => {
    const v = judgeExistingSidecar({ dataDir: DIR, version: "1.0.0", pid: 7 }, DIR, "1.2.3");
    expect(v.action).toBe("replace");
    expect(v.pid).toBe(7);
    expect(v.reason).toContain("stale version");
  });

  it("dataDir 不一致は入れ替え", () => {
    const v = judgeExistingSidecar({ dataDir: "/other", version: "1.2.3", pid: 8 }, DIR, "1.2.3");
    expect(v).toMatchObject({ action: "replace", pid: 8 });
    expect(v.reason).toContain("foreign dataDir");
  });

  it("未認証の最小応答（dataDir なし・pid あり）でも pid を取って入れ替える", () => {
    const v = judgeExistingSidecar({ status: "healthy", pid: 9, desktop: true }, DIR, "1.2.3");
    expect(v).toMatchObject({ action: "replace", pid: 9 });
    expect(v.reason).toContain("unauthenticated");
  });

  it("pid が取れない相手は pid 0", () => {
    expect(judgeExistingSidecar({ status: "healthy" }, DIR, "1.2.3")).toMatchObject({ action: "replace", pid: 0 });
    expect(judgeExistingSidecar(null, DIR, "1.2.3")).toMatchObject({ action: "replace", pid: 0 });
  });
});
