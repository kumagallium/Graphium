import { describe, expect, it } from "vitest";
import { rewriteDevProxyOrigin } from "./dev-proxy-origin";

const TARGET = "http://127.0.0.1:3001";

describe("rewriteDevProxyOrigin", () => {
  it("dev サーバー自身の Origin（host 一致）は宛先のオリジンへ書き換える", () => {
    expect(rewriteDevProxyOrigin("http://localhost:5180", "localhost:5180", TARGET)).toBe(TARGET);
    expect(rewriteDevProxyOrigin("http://127.0.0.1:5174", "127.0.0.1:5174", TARGET)).toBe(TARGET);
  });

  it("ほかのサイト・別ポートの Origin は書き換えない", () => {
    expect(rewriteDevProxyOrigin("https://evil.example.com", "localhost:5180", TARGET)).toBeUndefined();
    expect(rewriteDevProxyOrigin("http://localhost:5181", "localhost:5180", TARGET)).toBeUndefined();
  });

  it("Origin 無し・\"null\"・Host 無しは書き換えない", () => {
    expect(rewriteDevProxyOrigin(undefined, "localhost:5180", TARGET)).toBeUndefined();
    expect(rewriteDevProxyOrigin("null", "localhost:5180", TARGET)).toBeUndefined();
    expect(rewriteDevProxyOrigin("http://localhost:5180", undefined, TARGET)).toBeUndefined();
  });
});
