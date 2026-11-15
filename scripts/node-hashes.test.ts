import { describe, expect, it } from "vitest";
// @ts-expect-error 型宣言の無い .mjs
import { parseShasums, replaceHashTable } from "./node-hashes.mjs";

const h = (c: string) => c.repeat(64);

describe("node-hashes", () => {
  const shasums = [
    `${h("b")}  node-v22.1.0-linux-x64.tar.gz`,
    `${h("a")}  node-v22.1.0-darwin-arm64.tar.gz`,
    `${h("c")}  node-v22.1.0-win-x64.zip`,
    `${h("d")}  node-v22.1.0-x64.msi`,
    `${h("e")}  node-v22.0.0-darwin-x64.tar.gz`,
    `zzz  node-v22.1.0-win-arm64.zip`,
  ].join("\n");

  it("対象の版の配布アーカイブだけを名前順で拾う", () => {
    const entries = parseShasums(shasums, "v22.1.0");
    expect(entries.map((e: string[]) => e[1])).toEqual([
      "node-v22.1.0-darwin-arm64.tar.gz",
      "node-v22.1.0-linux-x64.tar.gz",
      "node-v22.1.0-win-x64.zip",
    ]);
  });

  it("マーカーの間だけを置き換える", () => {
    const src = "a\n// <node-sha256:begin>\nconst NODE_SHA256 = {\n  \"old\": \"x\",\n};\n// <node-sha256:end>\nb $& c";
    const out = replaceHashTable(src, parseShasums(shasums, "v22.1.0"));
    expect(out.startsWith("a\n// <node-sha256:begin>\n")).toBe(true);
    expect(out.endsWith("// <node-sha256:end>\nb $& c")).toBe(true);
    expect(out).not.toContain('"old"');
    expect(out).toContain(`"node-v22.1.0-win-x64.zip": "${h("c")}",`);
  });
});
